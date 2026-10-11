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
    ke-client/                   ← Knowledge Enrichment client via Nuxeo CIC automation
    document-layouts/            ← Per-type layouts: package layout files or schema-generated (NXSAT-311); internal, not in the platform package
    satori-components/           ← nxs- component library, published as @nuxeo-satori/platform/components (NXSAT-308, below)
    satori-components-satori/    ← the same primitive IDs on Satori, published as @nuxeo-satori/platform/components-satori
    adf-hx-bridge/               ← HxPR bridge + hxp-* UI for adf-hx browse POC (see ARCHITECTURE.md)
```

---

## `nxs-` component library (NXSAT-308)

`libs/shared/satori-components` holds the Nuxeo-owned components that replace the adf-hx ones.
It is published as `@nuxeo-satori/platform/components` — `@nuxeo/satori-platform/components`
after the scope rename sweep. Selector prefix `nxs-`, class prefix `Nxs`.

**Tags: `scope:shared` and `type:ui`**, the same pair as `libs/shared/ui`. `scope:shared` because
features, the app and `libs/platform` (`type:publishable`, which may depend on `scope:shared`) all
consume it and it must never depend on a feature; `type:ui` because that is what the app's rule
admits. No new `depConstraints` entry was needed. Tags cannot say "no ADF, no Satori" — those are
npm packages, not projects — so that is what the guardrails below are for.

**Rules.** Each is a guardrail in `scripts/review-guardrails.mjs`, run by the `guardrails` gate and
by CI, with negative controls in `scripts/review-guardrails.selftest.mjs` (the `guardrails-selftest`
gate, also in CI):

| Rule                                                                                                                                                                                                                                                                                                                                          | Guardrail                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| No `@alfresco/*` and no `@hylandsoftware/*` — imported directly (even when a tsconfig alias maps the name to a workspace file), reached through any workspace import, or loaded by a stylesheet or inline `styles`. A type-only import counts. Stylesheet paths are read from the syntax tree; one the guardrail cannot read statically fails | `checkSatoriComponentsDependencies`        |
| Reached only through `@nuxeo-satori/platform/components`: no subpath under it, no relative path into the library, no second alias in any tsconfig (a project's own `paths` included), and the alias and `libs/platform/components/ng-package.json` both name `src/index.ts`                                                                   | `checkSatoriComponentsEntryPoint`          |
| Federation readiness: no `@NgModule`, every component, directive and pipe says `standalone: true`, and no `providedIn` of any value                                                                                                                                                                                                           | `checkSatoriComponentsFederationReadiness` |
| Every component the barrel exports has a `*.stories.ts` under `src/` whose meta says `component: <Class>` and exports a story, and `.storybook/main.ts` loads `../src/**/*.stories.ts`                                                                                                                                                        | `checkSatoriComponentsHaveStories`         |
| `libs/shared/satori-components-satori` may import `@hylandsoftware/satori-ui` and nothing else from GitHub Packages, no ADF and no HxCS client, followed transitively                                                                                                                                                                         | `checkSatoriFallbackDependencies`          |
| It is reached only through `@nuxeo-satori/platform/components-satori`, by the same rules as the base library                                                                                                                                                                                                                                  | `checkSatoriFallbackEntryPoint`            |
| `apps/nuxeo-ui` lists `provideNxsComponents()` before `provideNxsSatoriComponents()` in its providers                                                                                                                                                                                                                                         | `checkSatoriPrimitivesRegisteredInOrder`   |

**Satori if available, Material otherwise — by ID** (plan section 3). Four primitives overlap with
Satori: avatar, breadcrumbs, tag and rich tooltip. `/components` implements each on Material and
`provideNxsComponents()` registers them as `nxs.primitives.*` (`NXS_PRIMITIVE_IDS`).
`@nuxeo-satori/platform/components-satori` — its own project, `libs/shared/satori-components-satori`,
same tags — re-registers the same IDs on Satori with `provideNxsSatoriComponents()`. Both go through
`provideSatoriExtensions`, so later wins: the app lists both in that order, and an application
without GitHub Packages access lists only the first. Each pair implements one `Nxs…Inputs`
interface and a spec compares their declared inputs, so `componentInputs` mean the same thing
whichever is registered. `@hylandsoftware/satori-ui` is an **optional** peer of the package, and
`beta:installable` proves the built tarball installs without it. The IDs are in
`docs/extension-reference.md` §6a; no packaged screen renders them yet. The base library's value
unions (`NxsAvatarColor` and the rest) are asserted equal to Satori's at compile time in
`/components-satori`, since `/components` may not import Satori to check.

**Storybook 9** (`@nx/storybook`, `@storybook/angular`) documents the library, one story per
exported component:

```bash
npx nx run satori-components:storybook              # dev server on :6006
npx nx run satori-components:build-storybook        # static build, dist/storybook/satori-components
npx nx run satori-components:build-storybook:satori # the same under Satori's theme; needs the token
```

The default build needs **no GitHub Packages token**: it themes with plain `mat.theme`
(`.storybook/material-theme.scss`), and `checkSatoriComponentsDependencies` covers `.storybook/*.ts`
and the default configuration's `styles` as well as `src/`. Whenever the library is affected, CI
builds it with `@hylandsoftware` and `@alfresco` removed from `node_modules`, so an accidental
Satori import fails the build rather than compiling. Only the opt-in `:satori` configuration reaches `@hylandsoftware/satori-ui`, for its theme.
`typecheck` type-checks the stories too. Where the static build is hosted is not decided.

**Coverage: a hard 90% line floor** (`FLOORS` in `scripts/beta-harness/coverage-gate.mjs`), from
the first commit rather than ratcheted, counted on distinct lines rather than statements. The
floor also fails when the library was not measured, when its report is stale — older than its
source, or counting a file since deleted — and when any of its files sits outside the
measurement — only `noStatements` barrels are excused, never a dated allowlist entry. `npm run beta:coverage` runs at the end of the SonarCloud workflow,
after its test-with-coverage step.

**`@nuxeo-satori/platform/nuxeo-client` and `@nuxeo-satori/platform/extensions` are importable**,
because the dependency rule follows imports and neither barrel now reaches a banned package.
Both once did: `nuxeo-client`'s `avatar-colors.ts` imported a Satori type, and `extensions` imported
`@alfresco/adf-extensions`. Controls in `scripts/review-guardrails.selftest.mjs` run the rule over
the real `libs/` tree and put each import back, so a regression in either barrel is red there.
`nxs-drive-dialog`, `nxs-domain-hint` and `nxs-doc-type-icon` import `nuxeo-client`.

If another library is refused, fix the file that carries the package, rather than copying code
into the library to dodge the rule.

**Adding a component, with every gate staying green:**

1. `src/lib/<name>/<name>.component.{ts,html,scss,spec.ts}` — selector `nxs-<name>`, class
   `Nxs<Name>Component`, `standalone: true`, `templateUrl`, theme tokens only.
2. Text inputs take already-translated strings; the library ships no catalogue.
   `checkNoProseInComponentInputs` scans `nxs-` elements, so a caller must bind them. A
   component's own chrome — headings, buttons, messages, accessible names — is translated with keys
   under `satori-components.<name>.*` in the app catalogue (`apps/nuxeo-ui/public/i18n/en.json`
   plus `en.context.json`, and `en-fallback.ts` too if the key names a control), written as
   literals or literal-prefixed template strings so that `node tools/i18n/platform-english.mjs`
   finds them and ships their English with the package. A message that belongs to a
   `nuxeo-client` rule keeps that rule's exported key instead: `nxs-domain-hint` shows
   `DOMAIN_CONTAINER_GUIDANCE_KEY`, the sentence the Create / Import checks give, so one
   translation serves every place the rule speaks.
3. The spec covers the empty and error paths and keeps the library at 90% or more:
   `npx nx test satori-components --coverage.enabled=true`, then `npm run beta:coverage`.
4. Export it from `src/index.ts`, run `npm run beta:api -- --update` and review the
   `docs/api/platform.api.md` diff, then `npm run beta:publishable`.
5. `src/lib/<name>/<name>.stories.ts` with `component: Nxs<Name>Component` in its meta and a story
   per meaningful state; `checkSatoriComponentsHaveStories` fails an exported component without one.
   Stories and `.storybook/` are outside the coverage floor and SonarCloud, like specs.
6. A new runtime dependency is a `libs/platform/package.json` peer, or is listed in
   `allowedNonPeerDependencies`.
7. Shared state is an `InjectionToken` with an exported `provide…()` function, never `providedIn`.
   A service only one component uses goes in that component's `providers`, as
   `NxsPermissionsService` does.
8. Members only the template uses are `protected`, so the component's contract is its inputs and
   outputs. Specs reach them by element access (`panel()['save']()`).
9. A component that replaces packaged markup is registered by ID (`nxs.<group>.<name>`, exported as
   a constant) and rendered through `lib-extension-outlet` with the component as the unresolved
   fallback, so a customer library can re-register the ID. `beta:reference` checks `nxs.*` IDs
   against `docs/extension-reference.md` as it does `app.*` ones.

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
- Imports: `@nuxeo-satori/platform/nuxeo-client`, `@nuxeo-satori/platform/ui`, `@nuxeo-satori/platform/components`, `@agentic-ui/shared/ai-client`, `@agentic-ui/shared/kd-client`, `@agentic-ui/shared/ke-client`
