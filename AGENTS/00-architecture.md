# Architecture — Nuxeo Agentic UI

## Stack

| Layer                | Technology                                                      |
| -------------------- | --------------------------------------------------------------- |
| Frontend framework   | Angular 22 (standalone components, signals)                     |
| Monorepo tool        | Nx 23                                                           |
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
    satori-components/           ← nxs- component library, published as @nuxeo/satori-platform/components (NXSAT-308, below)
    satori-components-satori/    ← the same primitive IDs on Satori, published as @nuxeo/satori-platform/components-satori
```

---

## `nxs-` component library (NXSAT-308)

`libs/shared/satori-components` holds the Nuxeo-owned components that replace the adf-hx ones.
It is published as `@nuxeo/satori-platform/components` — `@nuxeo/satori-platform/components`
after the scope rename sweep. Selector prefix `nxs-`, class prefix `Nxs`.

**Tags: `scope:shared` and `type:ui`**, the same pair as `libs/shared/ui`. `scope:shared` because
features, the app and `libs/platform` (`type:publishable`, which may depend on `scope:shared`) all
consume it and it must never depend on a feature; `type:ui` because that is what the app's rule
admits. No new `depConstraints` entry was needed. Tags cannot say "no ADF, no Satori" — those are
npm packages, not projects — so that is what the guardrails below are for.

**Rules.** Each is a guardrail in `scripts/review-guardrails.mjs`, run by the `guardrails` gate and
by CI, with negative controls in `scripts/review-guardrails.selftest.mjs` (the `guardrails-selftest`
gate, also in CI):

| Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Guardrail                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| No `@alfresco/*` and no `@hylandsoftware/*` — imported directly (even when a tsconfig alias maps the name to a workspace file), reached through any workspace import, or loaded by a stylesheet or inline `styles`. A type-only import counts. Stylesheet paths are read from the syntax tree; one the guardrail cannot read statically fails                                                                                                                                     | `checkSatoriComponentsDependencies`        |
| Reached only through `@nuxeo/satori-platform/components`: no subpath under it, no relative path into the library, no second alias in any tsconfig (a project's own `paths` included), and the alias and `libs/platform/components/ng-package.json` both name `src/index.ts`                                                                                                                                                                                                       | `checkSatoriComponentsEntryPoint`          |
| Federation readiness: no `@NgModule`, every component, directive and pipe says `standalone: true`, and no `providedIn` of any value                                                                                                                                                                                                                                                                                                                                               | `checkSatoriComponentsFederationReadiness` |
| Every component the barrel exports has a `*.stories.ts` under `src/` whose meta says `component: <Class>` and exports a story, and `.storybook/main.ts` loads `../src/**/*.stories.ts`. Every story meta that names a component carries the `autodocs` tag, so the component has its API page                                                                                                                                                                                     | `checkSatoriComponentsHaveStories`         |
| Every component the barrel exports has an Overview: an `*.mdx` under `src/` attached to its story file with `<Meta of={Stories} name="Overview" />`, with the Key features, Demo showcase, Usage, Examples and Accessibility sections and at least one `<Canvas>`; a story file naming no component has one too; `main.ts` loads `../src/**/*.mdx`. On every page under `src/` and `.storybook/`, each `of={X.Y}` names a story the file exports and no Markdown table is written | `checkSatoriComponentsHaveOverviews`       |
| `libs/shared/satori-components-satori` may import `@hylandsoftware/satori-ui` and nothing else from GitHub Packages, no ADF and no HxCS client, followed transitively                                                                                                                                                                                                                                                                                                             | `checkSatoriFallbackDependencies`          |
| It is reached only through `@nuxeo/satori-platform/components-satori`, by the same rules as the base library                                                                                                                                                                                                                                                                                                                                                                      | `checkSatoriFallbackEntryPoint`            |
| `apps/nuxeo-ui` lists `provideNxsComponents()` before `provideNxsSatoriComponents()` in its providers                                                                                                                                                                                                                                                                                                                                                                             | `checkSatoriPrimitivesRegisteredInOrder`   |
| Every `@Component` in either library has a spec that imports it by value, or imports what opens it — the coverage floor passes a component nothing tests once its module is imported                                                                                                                                                                                                                                                                                              | `checkSatoriComponentsHaveSpecs`           |
| Neither library puts Material's native date adapter in an injector — `provideNativeDateAdapter()`, `MatNativeDateModule`, or `NativeDateAdapter` as a provider — which hides the host's adapter and reads typed dates as American (NXSAT-629). Specs and stories are exempt                                                                                                                                                                                                       | `checkSatoriLibrariesKeepHostDateAdapter`  |
| `PLATFORM_ENTRY_POINTS` in `libs/platform/src/index.ts` lists exactly the subpaths a `libs/platform/<subpath>/ng-package.json` publishes                                                                                                                                                                                                                                                                                                                                          | `checkPlatformEntryPointsListed`           |
| Every Storybook `<Source>` code sample under `libs/` and `apps/` parses and is formatted as Prettier formats its language, and no inline sample has an indented continuation line, which MDX strips                                                                                                                                                                                                                                                                               | `checkMdxCodeSamplesFormatted`             |

**Satori if available, Material otherwise — by ID** (plan section 3). Seven primitives overlap with
Satori: avatar, breadcrumbs, tag, status tag, rich tooltip, error state and card. `/components`
implements each on Material and `provideNxsComponents()` registers them as `nxs.primitives.*`
(`NXS_PRIMITIVE_IDS`). `@nuxeo/satori-platform/components-satori` — its own project,
`libs/shared/satori-components-satori`, same tags — re-registers all but the card on Satori with
`provideNxsSatoriComponents()`; until Satori's interactive card is wrapped, `nxs.primitives.card`
renders the Material `nxs-card` either way. Both go through
`provideSatoriExtensions`, so later wins: the app lists both in that order, and an application
without GitHub Packages access lists only the first. Each pair implements one `Nxs…Inputs`
interface and a spec compares their declared inputs, so `componentInputs` mean the same thing
whichever is registered. `@hylandsoftware/satori-ui` is an **optional** peer of the package, and
`beta:installable` proves the built tarball installs without it. The IDs are in
`docs/extension-reference.md` §6a. Browse and the collection page render their breadcrumbs by ID,
browse's and search's card views each card, and `nxs-document-list` each row's type tag and
contributor avatar; other packaged screens do not yet. The outlet sets inputs only, so the card
takes its open and selection handlers and its thumbnail and action templates as inputs and has no
outputs. The base library's value
unions (`NxsAvatarColor` and the rest) are asserted equal to Satori's at compile time in
`/components-satori`, since `/components` may not import Satori to check.

**Storybook 10** (`@nx/storybook`, `@storybook/angular`) documents the library, published at
<https://nuxeo.github.io/agentic-ui-poc/>. Each component has an Overview, an API page and its
stories, after a Getting started page:

```bash
npx nx run satori-components:storybook              # dev server on :6006
npx nx run satori-components:build-storybook        # static build, dist/storybook/satori-components
npx nx run satori-components:build-storybook:satori # the same under Satori's theme; needs the token; never published
```

The default build needs **no GitHub Packages token**: it themes with plain `mat.theme`
(`.storybook/material-theme.scss`), and `checkSatoriComponentsDependencies` covers `.storybook/*.ts`
and the default configuration's `styles` as well as `src/`. Whenever the library is affected, CI
builds it with `@hylandsoftware` and `@alfresco` removed from `node_modules`, so an accidental
Satori import fails the build rather than compiling. Only the opt-in `:satori` configuration reaches `@hylandsoftware/satori-ui`, for its theme.
`typecheck` type-checks the stories too.

**Publishing.** `.github/workflows/storybook-pages.yml` builds the default configuration the same
token-free way and deploys it to GitHub Pages on every push to `integration/nxsat-308` (to `main`
once that merges, NXSAT-649). **Only that build may be published.** `satori-components-satori`'s
Storybook bundles compiled `@hylandsoftware/*` modules, `--sat-*` tokens and Satori's fonts, and the
`:satori` configuration the tokens and fonts; we may consume them but not redistribute them. This
repository is public, so a workflow artifact is published too: neither build may be uploaded as one.
`scripts/storybook-publication-gate.mjs` refuses an artifact carrying any of them before upload, and
CI runs it after its own build of this Storybook, so a change to the library that would block the
deployment fails its pull request first. Its allowances are explicit and few: the Getting started
page's sentences naming the package, the text of our own `libs/` and `apps/` files in source maps,
and Storybook's Nunito Sans. Anything else fails, as does an allowance that matches nothing — so
when Getting started gains or loses a mention of `@hylandsoftware`, update `ALLOWANCES` in the gate.

What each page documents, and where it comes from. All of it is customer-facing, so no ticket,
branch or change history:

- **Getting started** (`.storybook/getting-started.mdx`): install, the two entry points and why
  there are two, the providers, and registering by ID.
- **Overview** (`src/lib/<name>/<name>.mdx`, `@storybook/addon-docs` MDX): written by hand and
  attached to the story file with `<Meta of={Stories} name="Overview" />`. What the component is and
  when to use it, `## Key features`, `## Demo showcase` (a `<Canvas>`), `## Usage` (the import, any
  providers, the registered ID), `## Examples` (a `<Canvas>` per meaningful state), and
  `## Accessibility`. A component backed by a service adds `## Where its data comes from`, naming
  the service, and says the stories use an in-memory fake; the five primitives add what Satori's
  version of the same ID changes. `preview.ts` shows the code under every `<Canvas>`, with zoom
  tools above it, and a table of contents of the `##` and `###` headings.
- **API**: the `autodocs` page, renamed by `docs.defaultName` in `main.ts` and rendered by
  `.storybook/api-page.ts` (`parameters.docs.page`). Inputs and outputs under the names a template
  binds — an alias, or `<name>Change` for a `model()`'s output — from Angular's compiled metadata
  (`reflectComponentType`), each with Compodoc's type, required flag, default and JSDoc; public
  methods with their signature; and the library interfaces those types name (plus any listed in a
  meta's `parameters.docs.api.types`, as the Drive dialog lists its dialog data). No row is written
  by hand, and `.storybook/api-members.spec.ts` checks the names against Angular's metadata for
  every exported component. An input's JSDoc is its description there, so keep it free of
  maintainer notes; put those in a `//` comment.
- **Compodoc** is the project's `compodoc` target, which `typecheck`, `test`, `storybook` and
  `build-storybook` depend on. It reads `tsconfig.lib.json` and writes the gitignored
  `libs/shared/satori-components/documentation.json`, leaving out private, protected, `@internal`
  and lifecycle members and the source, templates and styles nothing reads. `.storybook/compodoc.ts`
  types it, and `typecheck` depends on the target so that shape is checked against the JSON
  Compodoc writes rather than a hand-written stand-in. Do not name a declaration file after a `.ts`
  file beside it (`compodoc.d.ts` next to `compodoc.ts`): TypeScript treats it as that file's
  output and skips it. The dev server runs it once at start, so restart it to see new JSDoc.
  `preview.ts` also marks an input required in the Controls table from Compodoc's `required`, which
  Storybook's Compodoc reader ignores.
- **A numeric union needs its own control.** Compodoc writes a numeric literal as a quoted string —
  `NxsHeadingLevel`'s `1 | … | 6` becomes `"1" | … | "6"`, the same as a real string union such as
  `NxsAvatarSize` — so the control Storybook infers offers strings. Give the input a `select` whose
  `options` are typed as the union, as `headingLevel` has in the folder header and empty state
  stories. Without one, choosing a value renders the default, and the dev server's **Update story**
  writes the string into the story file, which `typecheck` and `build-storybook` then reject. Update
  story and Create new story edit the working tree: read the diff before committing it.
- **Code under a preview** is generated from the story's args for a story with none of its own
  markup, so it follows the Controls; a story with a `template` shows that template. Galleries
  (every size, every colour) are written as fixed markup with Controls disabled, so the code is
  exactly what renders.
- **MDX has no GitHub-flavoured Markdown** — `remark-gfm` is not installed — so a Markdown table
  renders as a paragraph of pipes. Write tables as `<table>` markup.
- **A multi-line code sample goes in an `export const`** just above its `<Source code={name} />`.
  MDX strips up to two leading spaces from every continuation line of an attribute expression, so
  one written inline in `code={`…`}` renders with its first level of indentation lost. Prettier
  does not format MDX (`.prettierignore`): it parses MDX 1, where a blank line inside a sample ends
  the JSX block, and re-flows the rest of the sample as Markdown.
- **A story whose component renders router links** provides `provideStoryRouter()`
  (`.storybook/story-router.ts`): hash location, and an empty route for each path the stories link
  to, so following a link stays in the story. Add a path there when a story links somewhere new;
  without a match the router logs NG04002 and resets the iframe's URL.
- **A dialog's stories show it as MatDialog opens it**: `render: dialogPreview('<selector>',
{ width, maxWidth })` (`.storybook/dialog-preview.ts`), with the sizes the application's
  `dialog.open` passes, given as `render:` rather than spread into the meta, which the guardrails
  cannot read through. It renders MatDialog's own pane, container and surface, and loads Material's
  dialog stylesheet, which ships only with a `MatDialogContainer`; a hand-drawn surface has no
  title, content or actions padding. The interaction runner fails a `Dialogs/` story that is not
  laid out as MatDialog lays it out, at 1280 and 320 px (`scripts/storybook-dialog-layout.mjs`).
- **The Satori-backed variants are not in this Storybook.** It builds without GitHub Packages, so the
  primitives' Overviews describe what Satori's version changes and do not render it;
  `satori-components-satori` has its own Storybook, which needs the token and is never published.
- **Actions**: callback inputs and outputs are `fn()` args, and a story's in-memory fake of a
  service logs each call with `action()` — the permissions panel's `DocumentDetailService` and the
  Drive dialog's `NuxeoDriveService` do.
- **Accessibility panel** (`@storybook/addon-a11y`): observation only. `preview.ts` sets
  `a11y.test` to `todo`, which reports a violation as a warning; the WCAG verdict belongs to the
  axe runtime layer in `docs/accessibility.md`. The lock resolves its `axe-core` to the 4.13.0
  that `a11y/versions.mjs` records as the baseline engine.

**Coverage: a hard 90% line floor** (`FLOORS` in `scripts/beta-harness/coverage-gate.mjs`), from
the first commit rather than ratcheted, counted on distinct lines rather than statements. The
floor also fails when the library was not measured, when its report is stale — older than its
source, or counting a file since deleted — and when any of its files sits outside the
measurement — only `noStatements` barrels are excused, never a dated allowlist entry. `npm run beta:coverage` runs at the end of the SonarCloud workflow,
after its test-with-coverage step.

**`@nuxeo/satori-platform/nuxeo-client` and `@nuxeo/satori-platform/extensions` are importable**,
because the dependency rule follows imports and neither barrel now reaches a banned package.
Both once did: `nuxeo-client`'s `avatar-colors.ts` imported a Satori type, and `extensions` imported
`@alfresco/adf-extensions`. Controls in `scripts/review-guardrails.selftest.mjs` run the rule over
the real `libs/` tree and put each import back, so a regression in either barrel is red there.
`nxs-drive-dialog`, `nxs-domain-hint` and `nxs-doc-type-icon` import `nuxeo-client`.

If another library is refused, fix the file that carries the package, rather than copying code
into the library to dodge the rule.

**Adding a component, with every gate staying green.** Start from the generator, which does
steps 1–5 and step 10's page edit for a component a slot will place:

```bash
npx nx g ./tools/satori-generators:satori-component claim-summary --slot=documentView
```

It writes the component (an optional `heading` as a native heading at a typed `headingLevel`), a
spec that asserts the registration and renders it the way its slot's host does — `tabs` and
`sidebar` set no inputs, `documentView` sets the entry's `inputs` and the document, `routes` sets
them from route data — a story tagged `autodocs` with `headingLevel`'s typed select, its Overview
`.mdx`, the barrel export, the `nxs.<slot>.<name>` registration in `provideNxsComponents()`, its
row in `docs/extension-reference.md` §6a, and its section and "All components" row on the
with-and-without-Satori page. Each goes through a marker it refuses to guess past, and the output
passes the per-component checks below unedited — tests and the coverage floor, lint, typecheck,
the review guardrails (story, Overview, entry point, labels), `beta:reference` and
`docs:satori-comparison:check`. One gate is red on purpose until you act: a new export changes the
public API, so `beta:api` fails until you run `npm run beta:api -- --update` and review the
snapshot diff (step 4). What it cannot do is yours: make the component do its job,
rewrite the Overview and the page section to say so, then capture and publish the page (step 10).
It is internal (`x-satori-internal` in `generators.json`): `nxs-` is our prefix, so it is not
shipped in the package; customers use `extension-component`. By hand, the steps are:

1. `src/lib/<name>/<name>.component.{ts,html,scss,spec.ts}` — selector `nxs-<name>`, class
   `Nxs<Name>Component`, `standalone: true`, `templateUrl`, theme tokens only. A rule styling an
   `<h1>`–`<h6>` doubles its class (`.nxs-x__heading.nxs-x__heading`): the app theme's
   `html[data-app-theme] .mat-typography h2` (0-2-2) otherwise outranks it and renders the heading
   at display size, as it did `nxs-error-state`'s and `nxs-empty-state`'s.
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
5. `src/lib/<name>/<name>.stories.ts` with `component: Nxs<Name>Component` and
   `tags: ['autodocs']` in its meta, and a story per meaningful state;
   `checkSatoriComponentsHaveStories` fails an exported component without one, and a component's
   story file without the tag. Callback inputs and outputs are `fn()` args. Then
   `src/lib/<name>/<name>.mdx`, its Overview, with the sections above and a `<Canvas>` per example
   — `checkSatoriComponentsHaveOverviews` fails an exported component without one. JSDoc on every
   input and output, which the API page shows. Stories, MDX and `.storybook/` are outside the
   coverage floor and SonarCloud, like specs.
6. A new runtime dependency is a `libs/platform/package.json` peer, or is listed in
   `allowedNonPeerDependencies`.
7. Shared state is an `InjectionToken` with an exported `provide…()` function, never `providedIn`.
   A service only one component uses goes in that component's `providers`, as
   `NxsPermissionsService` does. A stateless service many components use is listed in each
   consumer's `providers` through its `provide…()` function, as `NxsToastService` is
   (`provideNxsToast()`); a spec replaces it with `TestBed.overrideProvider`, which reaches a
   component's own providers where a root-level `{ provide, useValue }` does not.
8. Members only the template uses are `protected`, so the component's contract is its inputs and
   outputs. Specs reach them by element access (`panel()['save']()`).
9. A component that replaces packaged markup is registered by ID (`nxs.<group>.<name>`, exported as
   a constant) and rendered through `lib-extension-outlet` with the component as the unresolved
   fallback, so a customer library can re-register the ID. `beta:reference` checks `nxs.*` IDs
   against `docs/extension-reference.md` as it does `app.*` ones.
10. Put it on the with-and-without-Satori page. `docs/satori-components/with-and-without-satori.md`
    is the source of the Confluence page that shows every component without and with Satori:
    - add a `### <Name>` section under "Side by side" with its `| Field | Value |` table — the
      class; the ID something registers the component under, or `—` when nothing does;
      `Same component; theme only` (or, for a component `libs/shared/satori-components-satori`
      re-registers, `Satori's own component:` naming the `NxsSatori…Component` and the `<sat-…>`
      element its template renders, plus a second story from that library); and a story **of that
      component** — one whose Storybook meta names it, or that renders its registered ID through an
      outlet — then the image `<selector without nxs->-side-by-side.png`, and a row under
      "All components". The two `<!-- satori:comparison:* -->` markers are where the
      `satori-component` generator splices them, in the shape of `generatedComponent()` in
      `scripts/beta-harness/satori-comparison-doc.selftest.mjs`;
    - `npm run docs:satori-comparison:capture` renders every component both ways and writes the
      images to `$AGENTIC_UI_EVIDENCE_DIR/satori-comparison/`, outside the repository (needs
      `@hylandsoftware/satori-ui` installed, so the GitHub Packages token);
    - `npm run docs:satori-comparison:publish` updates the page in place and reads it back (your
      Confluence credentials; it refuses to run in CI).

    `npm run docs:satori-comparison:check` — the `nxs-comparison` gate, and a CI step — fails an
    exported component with no section, and a section whose component is gone.

---

## adf-hx browse POC — removed

The parallel browse at `/#/browse-adf-hx`, its search at `/#/search-adf-hx` and the
`libs/shared/adf-hx-bridge` library that backed them were removed on 2026-10-14 (NXSAT-635).
Browse is one surface, at `/#/browse`. Both old paths redirect, query string intact — see
`apps/nuxeo-ui/src/app/retired-routes.ts`.

---

## Routing

All routes use `HashLocationStrategy` (`/#/path`). This ensures Nuxeo/Tomcat serves `index.html` for all deep links without 404s.

| Path                | Component                    | Auth       |
| ------------------- | ---------------------------- | ---------- |
| `/#/login`          | LoginPageComponent           | Public     |
| `/#/dashboard`      | DashboardPageComponent       | Required   |
| `/#/browse`         | BrowseComponent              | Required   |
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
- Imports: `@nuxeo/satori-platform/nuxeo-client`, `@nuxeo/satori-platform/ui`, `@nuxeo/satori-platform/components`, `@agentic-ui/shared/ai-client`, `@agentic-ui/shared/kd-client`, `@agentic-ui/shared/ke-client`
