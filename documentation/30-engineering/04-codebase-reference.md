---
title: Codebase Reference
parent: Engineering
order: 4
last_reviewed: 2026-10-15
repo_commit: c053e63
audience: engineering
---

# Codebase Reference — file and folder responsibilities

> **Last reviewed:** 2026-10-15 · **Repository:** `c053e63` (`integration/nxsat-308`)
> Only the adf-hx bridge and POC-route passages were re-verified at that commit, for NXSAT-648.
> Before that, last reviewed 2026-10-11 at `ad60a57`:
> Only the entry-point count, the peer count and the secondary-entry-point row of §6 were verified
> at that commit. The rest of §6 and the `constants/avatar-colors.ts` row were re-verified at
> `effd434` (`feature/nxsat-308-satori-components`). The repository
> links (made relative rather than pinned to `feature/adf-hx-browse-poc`, every target present) and
> the `review-guardrails.mjs` row were re-verified on 2026-10-08 at `2898046`
> (`feature/nxsat-308-ci-cold-cache-tooling`), and the `verify-gate.mjs` and harness-script rows
> on 2026-10-08 at `fb97d44`. The rest of the page as of 2026-08-24 · `77265f9`.
> Directory-level view: [Repository Guide](03-repository-guide.md).
>
> **What is excluded, and why:** `node_modules/`, `dist/`, `coverage/`, `.angular/`, `.nx/`,
> `tmp/`, `test-results/`, `.DS_Store` — generated or vendored, no engineering intent.
> `package-lock.json` is excluded as a _file to read_ but is **load-bearing** (see the `npm ci`
> warning). Per-component `.html`/`.scss` pairs are not listed individually; they follow the
> `templateUrl` convention and carry no logic. Individual `*.spec.ts` files are not listed; test
> standards are in [Testing & Evidence](12-testing-and-evidence.md).

---

## 1. The files that matter most

If you read six files, read these.

| File                                                                                                                       | Lines | Why                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------- |
| [`apps/nuxeo-ui/src/app/app.config.ts`](../../apps/nuxeo-ui/src/app/app.config.ts)                                         |   ~97 | The composition root. Provider **order is load-bearing**, and the file explains why in detail         |
| [`apps/nuxeo-ui/src/app/app.routes.ts`](../../apps/nuxeo-ui/src/app/app.routes.ts)                                         |       | The entire surface area in one file. 23 routes                                                        |
| [`libs/shared/extensions/src/lib/extension-slots.ts`](../../libs/shared/extensions/src/lib/extension-slots.ts)             |   ~60 | The customisation contract. 8 slots                                                                   |
| [`libs/shared/extensions/src/lib/extension-rules.ts`](../../libs/shared/extensions/src/lib/extension-rules.ts)             |  ~261 | Rule evaluation, fail-open/fail-closed, depth-bounded recursion. Heavily commented with the reasoning |
| [`nuxeo-agentic-ui-package/src/main/resources/install.xml`](../../nuxeo-agentic-ui-package/src/main/resources/install.xml) |   ~25 | The upgrade-safety guarantee, and why the obvious destination is wrong                                |
| [`scripts/beta-harness/verify-gate.mjs`](../../scripts/beta-harness/verify-gate.mjs)                                       |  ~550 | Every gate in `ALL_GATES`, each with a comment saying what it caught                                  |

---

## 2. `apps/nuxeo-ui` — the shell

| Path                                               | Responsibility                        | Notes                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                                      | Bootstrap                             | 6 lines: `bootstrapApplication(App, appConfig)`                                                                                                                      |
| `src/app/app.config.ts`                            | **Composition root**                  | Layer 0 loader → Layer 1 registrations → theme initializer → HTTP + interceptor → router (hash location) → Satori → i18n → `CURRENT_USERNAME`, `ADMIN_ACCESS_CHECKS` |
| `src/app/app.routes.ts`                            | Routing                               | `login` (with `loginGuard`), then a shell route with `authGuard` and 22 children. `administration` adds `adminGuard`                                                 |
| `src/app/auth/auth.service.ts`                     | Session lifecycle                     | Basic + cookie sessions, `ensureHydrated()`, SSO detection via `/me`, explicit sign-out flag, share tokens                                                           |
| `src/app/auth/auth.guards.ts`                      | `authGuard`, `loginGuard`             | Both await `ensureHydrated()`                                                                                                                                        |
| `src/app/auth/admin.guard.ts`                      | `adminGuard`                          | Admits `hasAdministrationAccess()`; others → `/dashboard`                                                                                                            |
| `src/app/auth/nuxeo-auth.interceptor.ts`           | Adds `Authorization` to every request | **The reason `<img [src]>` is forbidden** — the browser bypasses this                                                                                                |
| `src/app/auth/session-timeout.service.ts` + dialog | Expiry warning                        |                                                                                                                                                                      |
| `src/app/auth/share-token.util.ts`                 | External share links                  | Read once during hydration, then stripped from the URL                                                                                                               |
| `src/app/config/provide-app-config.ts`             | Layer 0 wiring                        | Loads `bootstrap.json` and **repoints every configuration token** at the result                                                                                      |
| `src/app/extensions/provide-app-extensions.ts`     | Layer 1 registrations                 | The app's slots, rules, components, actions — incl. the **12 packaged `documentList` columns**                                                                       |
| `src/app/theme/app-theme.service.ts`               | Runtime theming                       | Invoked by `APP_INITIALIZER`                                                                                                                                         |
| `src/app/i18n/app-translate-loader.ts` | Layered catalogues | Precedence: satori-ui's catalogue, the app's catalogue, then manifest `labels`. Failed satori-ui fetches return `{}`; failed app fetches fall back to compiled-in English. |
| `src/app/shell/`                                   | App shell, nav drawer                 |                                                                                                                                                                      |
| `src/app/dashboard/`, `settings/`, `login/`        | Shell-level pages                     |                                                                                                                                                                      |

---

## 3. `libs/shared/nuxeo-client` — the integration layer

14,483 lines, 29 spec files, 78.4% coverage. Everything that talks to Nuxeo.

| File                                        | Lines | Responsibility                                                                                                                                                                                   |
| ------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `services/document-import.service.ts`       | 1,054 | **The largest service.** Batch staging, single and bulk create, property application, CSV server import, progress                                                                                |
| `services/document-detail.service.ts`       |   834 | Properties, ACLs, versions, comments, attachments, thumbnails, blob fetch                                                                                                                        |
| `services/search.service.ts`                |   772 | NXQL execution, aggregations, saved searches, suggestions                                                                                                                                        |
| `services/browse.service.ts`                |   611 | Children, tree, path resolution, CSV export                                                                                                                                                      |
| `services/content-lake-ingest.service.ts`   |   338 | Ingest commands, status probing, backfill, duplicates                                                                                                                                            |
| `services/directory.service.ts`             |   319 | Vocabularies, hierarchical entries, l10n labels                                                                                                                                                  |
| `services/administration.service.ts`        |   261 | Users, groups, audit, OAuth providers/tokens                                                                                                                                                     |
| `services/user.service.ts`                  |   260 | Current user, groups, suggestions                                                                                                                                                                |
| `services/settings.service.ts`              |   218 | Preferences                                                                                                                                                                                      |
| `services/trash.service.ts`                 |   188 | Trash listing and restore                                                                                                                                                                        |
| `services/task.service.ts`                  |   141 | Tasks                                                                                                                                                                                            |
| `services/principal-permissions.service.ts` |   132 | Permission rows, notification mail                                                                                                                                                               |
| `services/selection.service.ts`             |   124 | **Tracks ids, not documents** — the reason `selection` in the rule context is empty                                                                                                              |
| `services/` (others)                        |       | `arender`, `asset`, `asset-aggregation`, `browse-context`, `clipboard-target`, `collection`, `content-model`, `document`, `nuxeo-drive`, `search-aggregation`, `tag`, `trash-filter`, `workflow` |
| `utils/content-lake-ingest.ts`              |   323 | Marker properties, ingest-state derivation                                                                                                                                                       |
| `utils/document-compare.utils.ts`           |   320 | Comparison rows and sections                                                                                                                                                                     |
| `utils/browse-path.utils.ts`                |   175 | Path parsing, router-URL translation                                                                                                                                                             |
| `models/directory.model.ts`                 |   296 | Vocabulary shapes                                                                                                                                                                                |
| `auth/admin-access.token.ts`                |       | `ADMIN_ACCESS_CHECKS`, `CURRENT_USERNAME` — the app supplies the implementations                                                                                                                 |
| `constants/avatar-colors.ts`                |       | `AvatarColor` — **our own** union; nuxeo-client imports no design system. The app's dashboard page asserts it equals `SatAvatarCategory` both ways. Previously leaked that third-party type      |
| `src/index.ts`                              |   342 | The published barrel — 275 exported symbols                                                                                                                                                      |

---

## 4. `libs/shared/adf-hx-bridge` — the containment boundary

_Changed by NXSAT-635 (2026-10):_ removed on 2026-10-14 with the POC routes, and adf-hx with it by
NXSAT-637; none of the paths below exists. The section is kept as the record of what the library
held. The Nuxeo-owned components that replaced the adf-hx ones are in
`libs/shared/satori-components`.

8,380 lines, 12 spec files. **The only place adf-hx types may appear.** Enforced by
`checkNoAdfHxInPublicApi`, which walks each barrel's re-export graph to depth — the leak that cost
0.95 MB of initial bundle was two hops away.

| Path                                               | Responsibility                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/api/`                                         | Nuxeo implementations of the 12 adf-hx API ports                                                                                                         |
| `lib/api/hxql-literal.ts`                          | **Query escaping.** Backslash escaped **first** — the other order turns `\'` into `\\'`, a literal backslash plus an unescaped quote, reopening the hole |
| `lib/services/adf-hx-document.service.ts`          | Document mapping between Nuxeo and HxCS shapes                                                                                                           |
| `lib/services/adf-hx-browse-*.service.ts`          | Browse context, folder, media                                                                                                                            |
| `lib/services/nuxeo-acl.service.ts`                | ACL translation                                                                                                                                          |
| `lib/services/nuxeo-principal-resolver.service.ts` | Principal resolution                                                                                                                                     |
| `lib/services/nuxeo-document-router.service.ts`    | Routing adaptation                                                                                                                                       |
| `lib/ui/hxp-browse-nav-drawer/`                    | **A documented exception** to the adf-hx-in-barrel rule, with the reason recorded in the guardrail's allowlist                                           |
| `src/providers.ts`                                 | `provideAdfHxNuxeoBridge()` — all 12 ports                                                                                                               |
| `ARCHITECTURE.md`                                  | Read this before changing the bridge                                                                                                                     |

---

## 5. `libs/shared/extensions` — the four registries

3,101 lines, 9 spec files, 96.0% coverage. **Published** as `@nuxeo-satori/platform/extensions`.

| File                                          | Responsibility                                                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension-slots.ts`                          | The 8 slot IDs. **No enum, union or `switch` on slot identity** — that is what makes slots additive                                                                                                 |
| `extension-slot-registry.service.ts`          | Descriptors per slot; manifest merge                                                                                                                                                                |
| `extension-rules.ts`                          | Rule evaluation. Fail-open except `SECURITY_RELEVANT_RULE_IDS`; `MAX_RULE_DEPTH = 32`; the `core.*` composites as ordinary evaluators                                                               |
| `document-rules.ts`                           | The document-scoped rules                                                                                                                                                                           |
| `extension-rule-context.service.ts`           | `document` / `selectionCount` / `selection` — three independently populated halves                                                                                                                  |
| `extension-component-registry.service.ts`     | Lazily-resolved components by ID                                                                                                                                                                    |
| `extension-actions.ts`, `packaged-actions.ts` | Action registry and the packaged handlers                                                                                                                                                           |
| `extension-config.ts`                         | Manifest shape and merge                                                                                                                                                                            |
| `extension-outlet.component.ts`               | Renders a registered component by ID. **Usable as a route component** — it once crashed there because `withComponentInputBinding()` passes `undefined` for omitted inputs, defeating a `{}` default |
| `provide-satori-extensions.ts`                | One declarative object → four registries, via `provideEnvironmentInitializer` + `runInInjectionContext` so a customer's rule can `inject()`                                                         |

---

## 5a. `libs/shared/document-layouts` — per-type layouts

Internal: no `@nuxeo-satori/platform` entry point re-exports it. Its contract is the layout-file
format in [`docs/extension-reference.md`](../../docs/extension-reference.md) §9b.

| File                                 | Responsibility                                                                                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout-file.ts`                     | Reads the servlet's `layouts.json` and layout envelopes, and validates a layout file (version 1)                                                                                                      |
| `resolve-layout.ts`                  | Reads `/config/types/<type>` and `/config/schemas/<name>`; generates the default layout from the type's schemas, then the document's facet schemas; applies a contributed file, whole                 |
| `document-layout.service.ts`         | `layoutFor(type, mode, documentSchemas)`: lazy, cached reads — the layout reads skip the interceptors (no `Authorization` header); `vocabularyLabel(directory, id)`: one vocabulary entry, read by id |
| `document-layout/document-layout.ts` | `<lib-document-layout>`: sections or tabs in the Properties panel; vocabulary labels; translation-key labels                                                                                          |
| `document-layout/field-view.ts`      | How one value is shown, chosen from its schema type                                                                                                                                                   |

---

## 6. `libs/platform` — the publishable package

Owns no logic. Wraps six shared libraries as entry points and ships the customer-facing assets.

| Path                                                                                   | Responsibility                                                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                                         | Name, version, **10 peers**, `private: true`, `generators` field                                                          |
| `ng-package.json`                                                                      | ng-packagr config + assets: README, AGENTS.md, extension reference, `generators.json`, `guardrails/**`, `generators/**`   |
| `tsconfig.lib.json`                                                                    | **The entire compiler configuration**, not overrides. Two defects came from options being _absent_                        |
| `{app-config,components,components-satori,extensions,nuxeo-client,ui}/ng-package.json` | The six secondary entry points, pointing at `../../shared/*/src/index.ts`                                                 |
| `guardrails/check-extension-library.mjs`                                               | The 5 customer checks, shipped in the tarball                                                                             |
| `AGENTS.md`                                                                            | ~255 lines of customer procedure, shipped                                                                                 |
| `project.json`                                                                         | `build` depends on `sync-docs` **and** `sync-generators`, which must precede ng-packagr because it clears its destination |

---

## 7. `scripts/` — the harness

Full table in [Dev Harness & Gates](08-dev-harness-and-gates.md). Structure:

| Path                                                                                                                                                                                       | Responsibility                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `beta-harness/verify-gate.mjs`                                                                                                                                                             | Runs every gate in `ALL_GATES`, cheapest-first, stop at first failure                |
| `beta-harness/phase-runner.mjs`                                                                                                                                                            | Evidence runner. Exit 2 = precondition-not-met                                       |
| `beta-harness/helpers.mjs`                                                                                                                                                                 | `step`, `check`, `expectVisible`, `expectNoA11yViolations`, `requirePrecondition`, … |
| `beta-harness/steps/*.mjs`                                                                                                                                                                 | One per phase claim, plus a showcase and a `_template`                               |
| `beta-harness/{api-surface,publishability,fork-simulation,upgrade-rehearsal}.mjs`                                                                                                          | The four published-package gates                                                     |
| `beta-harness/{coverage,lockfile-integrity,dependency-tree,no-test-libs-in-bundle,assertion-audit,extension-reference-drift,state-check,node-version,backend-preflight,e2e-preflight}.mjs` | The rest                                                                             |
| `review-guardrails.mjs`                                                                                                                                                                    | Every commit-time invariant registered in its `GUARDRAILS` array                     |
| `build-platform-generators.mjs`                                                                                                                                                            | Compiles generators into the package. **The only thing that typechecks them**        |
| `sync-platform-docs.mjs`                                                                                                                                                                   | Copies customer docs in before the build                                             |
| `publish-confluence.mjs`                                                                                                                                                                   | Publishes `documentation/` to Confluence. Idempotent by title                        |
| `agent-context.sh`                                                                                                                                                                         | Emits the knowledge base for any LLM CLI                                             |
| `collect-evidence/NXSAT-*.mjs`                                                                                                                                                             | ~20 per-ticket evidence runners                                                      |

---

## 8. `tools/`

| Path                                                       | Responsibility                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `satori-generators/generators.json`                        | The 4 generators                                                                                                                                               |
| `satori-generators/src/extension-library/`                 | Generator + schema + 12 `__tmpl__` template files                                                                                                              |
| `satori-generators/src/extension-{rule,action,component}/` | Generator + schema                                                                                                                                             |
| `satori-generators/src/util/splice.ts`                     | Marker-comment splicing, **with a post-condition assertion** — the first version put every registration inside a comment                                       |
| `satori-generators/src/util/library-context.ts`            | Reads the library's `prefix` as the owner segment. Declares `SatoriProjectConfiguration` because `prefix` is a real `project.json` field absent from Nx's type |
| `stubs/ng-mocks/`                                          | Hand-written stub replacing the real `ng-mocks`, which adf-hx imports **from its shipped runtime bundle**                                                      |

---

## 9. The Java side

| Path                                                                           | Responsibility                                                                           |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `nuxeo-agentic-core/src/main/java/.../AgenticNotificationDocumentIdCodec.java` | URL codec so notification links resolve into this UI                                     |
| `nuxeo-agentic-core/src/main/resources/OSGI-INF/auth-config-agentic.xml`       | Auth contribution                                                                        |
| `nuxeo-agentic-core/.../login-startup-page-agentic-contrib.xml`                | Login start page                                                                         |
| `nuxeo-agentic-core/.../agentic-notification-doc-url-contrib.xml`              | Notification URL contribution                                                            |
| `nuxeo-agentic-ui-package/src/main/resources/install.xml`                      | **The upgrade-safety guarantee**                                                         |
| `nuxeo-agentic-ui-package/src/main/resources/package.xml`                      | Marketplace metadata                                                                     |
| `nuxeo-agentic-ui-package/src/main/assemble/assembly.xml`                      | Package assembly                                                                         |
| `nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/`                   | The configuration service, its extension point and the anonymous servlet (NXSAT-312)     |
| `nuxeo-agentic-core/src/main/resources/agentic-ui-config/*.defaults.json`      | Our Layer 0 and manifest defaults, contributed as `org.nuxeo.agentic.ui.config.defaults` |

---

## 10. Extension points, summarised

| Extension point                           | Mechanism                                                                                        | Who                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------ |
| Layer 0 config                            | A `bootstrap` fragment in the customer's Marketplace package, served by `AgenticUiConfigServlet` | Customer, no build |
| Layer 1 manifest                          | A `manifest` fragment in the customer's Marketplace package, served by the same servlet          | Customer, no build |
| Per-type layouts                          | A `<layout type mode>` file in the customer's Marketplace package, served by the same servlet    | Customer, no build |
| 8 slots (4 live)                          | `ExtensionSlotRegistry`                                                                          | Both               |
| Rules                                     | `ExtensionRuleRegistry`, `provideSatoriExtensions`                                               | Both               |
| Actions                                   | `ExtensionActionRegistry`                                                                        | Both               |
| Components by ID                          | `ExtensionComponentRegistry` + `ExtensionOutletComponent`                                        | Both               |
| ~~12 adf-hx API ports~~                   | Removed with the bridge on 2026-10-14 (NXSAT-635)                                                | —                  |
| `CURRENT_USERNAME`, `ADMIN_ACCESS_CHECKS` | Tokens the app implements                                                                        | Us                 |
| `AI_BACKEND_URL`                          | Token                                                                                            | Deployment         |
| Generators                                | Nx plugin in the package                                                                         | Customer           |
| Guardrail                                 | Script in the package                                                                            | Customer           |
