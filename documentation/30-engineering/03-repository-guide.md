---
title: Repository Guide
parent: Engineering
order: 3
last_reviewed: 2026-10-15
repo_commit: c053e63
audience: engineering
---

# Repository Guide

> **Last reviewed:** 2026-10-15 · **Repository:** `c053e63` (the tip of `integration/nxsat-308`)
> Every figure on this page was recounted at that commit (NXSAT-648): files as tracked there, lines
> as `wc -l` of their committed contents. An app's or library's **lines** are those of every tracked
> `.ts`, `.html` and `.scss` file in its folder — specs and stories included, configuration not —
> and its **specs** are its tracked `*.spec.ts` files. **Coverage** is the project's entry in
> `.ai/state/coverage-baseline.json`.
> 1,989 tracked files · ~218k lines of TS/HTML/SCSS (every such file) · ~58.5k lines of harness
> scripts (every `.mjs`, `.sh`, `.ps1` and `.ts` file in `scripts/`) · ~60.7k lines of Markdown
> (every `.md` file, 7.1k of them in the `.claude/` and `.agent/` mirrors)

An Nx monorepo with a Maven build layered on top of it, because the deliverable is a Nuxeo
marketplace package.

---

## 1. Top level

| Path                                                                                     | What it is                                                                                                                                         | Change it?                                                                                   |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`apps/`](../../apps)                                                                    | 3 Nx applications                                                                                                                                  | Yes                                                                                          |
| [`libs/`](../../libs)                                                                    | 26 Nx libraries — the bulk of the product                                                                                                          | Yes                                                                                          |
| [`scripts/`](../../scripts)                                                              | The development harness: gates, evidence, guardrails                                                                                               | Carefully — see [Dev Harness](08-dev-harness-and-gates.md)                                   |
| [`tools/`](../../tools)                                                                  | The 6 Nx generators, i18n/Crowdin and a11y-lint tooling, demo-video scripts, the `ng-mocks` stub                                                   | Yes                                                                                          |
| [`AGENTS/`](../../AGENTS)                                                                | 13-file agent knowledge base, 3,923 lines                                                                                                          | Yes, and you must when behaviour changes                                                     |
| [`docs/`](../../docs)                                                                    | 65 Markdown documents, 33.1k lines. Several superseded — see the [index](../README.md)                                                             | Yes                                                                                          |
| [`documentation/`](.)                                                                    | **This** documentation set, published to Confluence                                                                                                | Yes                                                                                          |
| [`.cursor/`](../../.cursor)                                                              | 12 Cursor rules, 17 skills, 3 agent definitions — the source of the two mirrors below                                                              | Yes                                                                                          |
| [`.claude/`](../../.claude), [`.agent/`](../../.agent)                                   | Generated, byte-identical copies of `.cursor/`'s skills, agents and rules (35 files each), plus a `MIRROR.md`                                      | No — edit `.cursor/` and run `npm run mirror:agents`; the `agent-mirror` gate fails on drift |
| [`.ai/state/`](../../.ai/state)                                                          | `phases.json`, `coverage-baseline.json` and three allowlists (uninstrumented coverage, sanitizer, supply chain) — gated machine state              | Only through the gates                                                                       |
| [`.github/`](../../.github)                                                              | 16 workflows, PR template, dependabot, CodeQL config, Copilot instructions and a Copilot agent                                                     | Yes                                                                                          |
| [`nuxeo-agentic-core/`](../../nuxeo-agentic-core)                                        | Java/OSGi bundle, 1,079 lines of Java and 776 of Java tests — the Layer 0 configuration service and servlet, URL codec, auth + login contributions | Rarely                                                                                       |
| [`nuxeo-agentic-ui-package/`](../../nuxeo-agentic-ui-package)                            | The marketplace package: `install.xml`, `package.xml`, assembly                                                                                    | **Escalate first** — a hard stop in the phase skill                                          |
| [`config-packages/`](../../config-packages)                                              | 2 configuration packages, `satori-beta` and `presales-demo`: bootstrap and manifest fragments as installable packages, each an Nx project          | Yes                                                                                          |
| [`nuxeo-conf/`](../../nuxeo-conf)                                                        | Server-side Nuxeo config fragments for local dev                                                                                                   | Yes                                                                                          |
| [`a11y/`](../../a11y)                                                                    | Runtime accessibility scanning — Playwright and a11y-scout; development tooling with an expected end date                                          | Yes                                                                                          |
| `.husky/`                                                                                | Git hooks: `commit-msg`, `pre-commit`, `pre-push`                                                                                                  | Carefully                                                                                    |
| `pom.xml`                                                                                | Maven parent — modules: `apps/nuxeo-ui`, `nuxeo-agentic-core`, `nuxeo-agentic-ui-package`                                                          | Rarely                                                                                       |
| `angular.json`, `nx.json`, `tsconfig.base.json`, `eslint.config.mjs`, `vitest.config.ts` | Workspace configuration                                                                                                                            | Carefully                                                                                    |
| `crowdin-conf.yml`, `sonar-project.properties`, `.gitguardian.yaml`                      | Crowdin, SonarCloud and GitGuardian configuration                                                                                                  | Carefully                                                                                    |
| `*-docker-compose.yml`, `nginx-arender-proxy.conf`, `.env.arender.example`               | ARender and Mailpit for local dev                                                                                                                  | Yes                                                                                          |
| `CLAUDE.md`, `AGENTS.md`, `.windsurfrules`                                               | Tool adapters onto `AGENTS/`                                                                                                                       | Yes                                                                                          |
| `README.md`, `CHANGELOG.md`, `DECISIONS-NEEDED.md`                                       | Readme, changelog, open integration-test decisions                                                                                                 | Yes                                                                                          |
| `README.charter.md`, `NUXEO_MARKETPLACE_GUIDE.md`                                        | Charter and packaging guide                                                                                                                        | Rarely                                                                                       |

### Deliberately excluded from documentation

`node_modules/`, `dist/`, `coverage/`, `.angular/`, `.nx/`, `tmp/`, `test-results/`,
`package-lock.json` (29k+ lines of generated resolution), `.DS_Store`. These are generated
or vendored and carry no engineering intent — with two exceptions worth knowing:

- **`package-lock.json` is load-bearing** despite being generated. See the `npm ci` warning
  in [Getting Started](01-getting-started.md#use-npm-ci-never-a-bare-npm-install).
- **`ng-mocks` is not a dependency.** A hand-written `file:` stub stood in for it while adf-hx
  imported that **test library from its shipped runtime bundle**, which put `ng-mocks`'
  implementation and two `eval()` calls into a customer-facing chunk. adf-hx left the tree in
  NXSAT-637 and the stub, with its supply-chain allowlist entry, went in NXSAT-672.
  `npm run beta:bundle` still fails if `ng-mocks` or an `eval()` from it reaches `dist/`.

---

## 2. Applications

| App                                                              |  Lines | Purpose                                                                                                                                      |
| ---------------------------------------------------------------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/nuxeo-ui`](../../apps/nuxeo-ui)                           | 23,628 | **The product.** Shell, routing, auth, theme, i18n, settings, dashboard, administration                                                      |
| [`apps/nuxeo-satori-template`](../../apps/nuxeo-satori-template) |  3,763 | **The forkable customer template.** Ships no Satori design system on purpose                                                                 |
| [`apps/nuxeo-ui-e2e`](../../apps/nuxeo-ui-e2e)                   |  1,524 | Playwright E2E — 5 specs, 25 tests: 4 critical paths (auth, browse, document detail, search) and a cross-engine spec, on Chromium and WebKit |

### `apps/nuxeo-ui` — what lives directly in the app rather than a library

Anything that is inherently _the shell_ and would be wrong to make reusable:

| Directory                                                                             | Responsibility                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/auth/`                                                                       | `AuthService`, `authGuard`, `loginGuard`, `adminGuard`, the HTTP interceptor, session timeout, share tokens                                                                                                 |
| `src/app/config/`                                                                     | `provideAppConfig()` — the Layer 0 loader wiring                                                                                                                                                            |
| `src/app/extensions/`                                                                 | `provide-app-extensions.ts` — the app's Layer 1 registrations, incl. the 12 packaged `documentList` columns                                                                                                 |
| `src/app/shell/`                                                                      | App shell, nav drawer, preset badge                                                                                                                                                                         |
| `src/app/theme/`                                                                      | `AppThemeService`, the theming feature flag and its guard                                                                                                                                                   |
| `src/app/i18n/`                                                                       | `AppTranslateLoader` — this app's catalogue over satori-ui's (`UPSTREAM_FOLDERS`), the manifest's `labels` over both; the compiled-in English fallback; Angular locale data for the 6 other shipped locales |
| `src/app/dashboard/`, `settings/`, `login/`, `personal-space/`, `features/contracts/` | Shell-level pages                                                                                                                                                                                           |
| `src/app/document-detail/`, `document-viewer/`                                        | Accessibility regression specs (focus rings, contrast) over library components; `document-detail/` also holds a toolbar focus stylesheet that `styles.scss` uses                                            |
| `src/app/assets/`, `pipes/`                                                           | The assets drawer, re-exported from `feature-assets`; `AiMarkdownPipe`                                                                                                                                      |
| `src/app/retired-routes.ts`                                                           | Redirects for the retired POC routes, `/browse-adf-hx` → `/browse` and `/search-adf-hx` → `/search`, so old bookmarks still land (NXSAT-635)                                                                |

### `apps/nuxeo-satori-template` — why it exists and why it is bare

It is what a customer forks. It ships **no Satori design system** on purpose — nothing in it
imports `@hylandsoftware/satori-ui` — so a fork does not have to remove ours before adding
theirs. It does load Angular Material's prebuilt `indigo-pink` theme in `src/styles.scss`,
because `@nuxeo/satori-platform/ui` is built on Material. Its own chrome reads `--shell-*`
custom properties, which `TemplateThemeService` writes from Layer 0 `themes[].tokens`; that is
why `--shell-*` is a recognised themed namespace in the guardrails rather than a faked one.

It also carries the reference Layer 0/1/2 customisation the upgrade rehearsal stages:
`public/agentic-ui-config/bootstrap.json`, `manifest.example.json`,
`src/app/extensions/template-extensions.ts`, and it consumes
[`libs/extensions/acme-extensions`](../../libs/extensions/acme-extensions).

---

## 3. Libraries

### Feature libraries — 9, 81,957 lines

**They never import each other.** Enforced by `depConstraints`.

| Library               |  Lines | Specs |                        Coverage |
| --------------------- | -----: | ----: | ------------------------------: |
| `document-detail`     | 23,894 |    43 |                          92.56% |
| `browse`              | 16,674 |    11 |                          98.75% |
| `administration`      | 14,108 |    15 |                          96.25% |
| `search`              |  6,330 |     6 |                          94.69% |
| `tasks`               |  6,327 |     5 |                           97.4% |
| `knowledge-discovery` |  4,102 |     3 |                          65.03% |
| `collections`         |  3,705 |     3 |                          95.02% |
| `assets`              |  3,701 |     1 |                          97.44% |
| `trash`               |  3,116 | **0** | not measured (no `test` target) |

> **Coverage is the ratchet baseline, not a fresh measurement.** It is each project's line figure
> in `.ai/state/coverage-baseline.json`, the floor `beta:coverage` holds it to, as recorded when the
> entry was last raised. Of the 24 projects with an entry, 21 are recorded at ≥90%. None is a 0/0
> any more — the artefact that once scored `tasks` and `assets` 100% with no spec files: the gate
> now calls a report that measures nothing unmeasurable, and fails a baseline entry for one. A
> figure covers only the statements v8 instrumented; files no test imports sit outside it, listed
> in `.ai/state/coverage-uninstrumented-allowlist.json` — 24 of them as dated debt, 2 in `assets`.

### Shared libraries — 13, 94,085 lines

The adf-hx bridge, `libs/shared/adf-hx-bridge`, was removed with the POC routes (NXSAT-635).

| Library                    |  Lines | Specs | Responsibility                                                                                                                                                                             |
| -------------------------- | -----: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `satori-components`        | 38,898 |    59 | The `nxs-` components, Material-backed with no Satori import. **Published** as `@nuxeo/satori-platform/components` (NXSAT-308)                                                             |
| `nuxeo-client`             | 22,926 |    55 | **The integration layer.** 26 services, models, utils. Everything that talks to Nuxeo. **Published** as `@nuxeo/satori-platform/nuxeo-client`                                              |
| `ui`                       | 10,179 |    26 | Shared presentational components and dialogs. **Published** as `@nuxeo/satori-platform/ui`                                                                                                 |
| `extensions`               |  6,032 |    14 | The 4 registries, rules, `provideSatoriExtensions`. **Published** as `@nuxeo/satori-platform/extensions`                                                                                   |
| `document-layouts`         |  4,662 |     8 | Per-type layouts for the Properties panel and the edit and create forms: a package's layout file, or generated from the type's schemas (NXSAT-311)                                         |
| `kd-client`                |  3,340 |     4 | Knowledge Discovery client                                                                                                                                                                 |
| `app-config`               |  2,709 |     6 | Layer 0 loader. **Published** as `@nuxeo/satori-platform/app-config`                                                                                                                       |
| `permission-dialogs`       |  1,864 |     3 | The 4 permission/sharing dialogs — moved here 2026-08-24 from `features/collections`                                                                                                       |
| `ke-client`                |  1,231 |     2 | Knowledge Enrichment client                                                                                                                                                                |
| `ai-client`                |  1,188 |     4 | The 12 `AI.*` operations. Thin HTTP client                                                                                                                                                 |
| `satori-components-satori` |    722 |     1 | Four `nxs-` primitive IDs — avatar, breadcrumbs, tag, rich tooltip — on Satori, and the platform package's only Satori import. **Published** as `@nuxeo/satori-platform/components-satori` |
| `testing`                  |    330 |     1 | Typed Nuxeo model fixtures, `nuxeoDocument` and `nuxeoAce`. Extracted from the bridge's port specs; nothing imports it since those went                                                    |
| `util`                     |      4 |     0 | One Nx-scaffold function, `sharedUtil()`. Nothing imports it                                                                                                                               |

### The other four

| Library                                                                    | Lines | Specs | Purpose                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | ----: | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`libs/platform`](../../libs/platform)                                     |    41 |     0 | `@nuxeo/satori-platform` — the publishable package. Its own code is `PLATFORM_ENTRY_POINTS`; it wraps 6 shared libs as entry points and ships docs, generators and the customer guardrail |
| [`libs/core`](../../libs/core)                                             |    42 |     1 | The untouched Nx scaffold — a placeholder `lib-core` component that nothing imports. Its `scope:core` tag is the bottom of the dependency graph                                           |
| [`libs/extensions/acme-extensions`](../../libs/extensions/acme-extensions) |   809 |     4 | The **reference customer** Layer 2 library — 7 registered IDs. Also the subject of `beta:customer-guardrails`                                                                             |
| [`libs/integration-tests`](../../libs/integration-tests)                   | 6,321 |     8 | Specs against a **live Nuxeo** (`npm run beta:integration`); its `test` target runs only the 2 server-free `*.unit.spec.ts`. Nothing may import it — see §4                               |

### Why `permission-dialogs` is not in `shared/ui`

`libs/shared/ui` is a **published** entry point (`@nuxeo/satori-platform/ui`). Putting the
four dialogs there would have added eight symbols to the customer-facing API for components
that are internal application UI. Once a customer can import a name, renaming it is a
breaking change. `document-layouts` is kept out of the published entry points for the same
reason: its layout-file format is the customer contract, not its classes.

---

## 4. Nx project tags

Tags are read from each `project.json`. What they permit is set by the seven `depConstraints` of
`@nx/enforce-module-boundaries` in `eslint.config.mjs`, and lint fails on an import between
projects that the last column does not allow. Nx applies every rule a project's tags match.
**A project whose tags match no rule cannot import any other project**
(`projectWithoutTagsCannotHaveDependencies`) — a new library needs a tag a rule reads before it
can import.

| Tags                                       | Projects                                                                                                             | May import projects tagged                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `scope:app`, `type:app`                    | `nuxeo-ui`                                                                                                           | `type:feature`, `type:ui`, `type:data-access`, `type:util`, `type:extension`, `type:publishable`   |
| `scope:template`, `type:app`               | `nuxeo-satori-template`                                                                                              | The same: no rule names `scope:template`, so `type:app` decides                                    |
| `scope:features`, `type:feature`           | the 9 feature libs                                                                                                   | `scope:shared`, `scope:core`, `type:testing` — **never another feature**                           |
| `scope:shared`, `type:data-access`         | `nuxeo-client`, `shared-app-config`, `shared-extensions`, `shared-ai-client`, `shared-kd-client`, `shared-ke-client` | `scope:shared`, `scope:core`, `type:testing`                                                       |
| `scope:shared`, `type:ui`                  | `satori-components`, `satori-components-satori`, `ui`, `document-layouts`, `permission-dialogs`                      | The same                                                                                           |
| `scope:shared`, `type:util`, `npm:private` | `shared-util`                                                                                                        | The same                                                                                           |
| `scope:shared`, `type:testing`             | `testing`                                                                                                            | The same                                                                                           |
| `scope:shared`, `type:publishable`         | `platform`                                                                                                           | The same — both rules it matches say so                                                            |
| `scope:core`, `type:util`                  | `core`                                                                                                               | `scope:core` only                                                                                  |
| `scope:customer`, `type:extension`         | `acme-extensions`                                                                                                    | `type:publishable`, `scope:shared`, `type:testing`                                                 |
| `type:integration-test`                    | `integration-tests`                                                                                                  | `scope:shared`, `scope:core`, `type:testing`. No rule admits its tag, so **nothing may import it** |
| `scope:customer`, `type:config`            | `satori-beta`, `presales-demo` (`config-packages/`)                                                                  | Nothing — no rule names either tag                                                                 |
| `scope:e2e`, `type:e2e`                    | `nuxeo-ui-e2e`                                                                                                       | Nothing — no rule names either tag                                                                 |
| none                                       | `@nuxeo-satori/generators`, `ng-mocks` (`tools/`); `agentic-ui-a11y`, which Nx infers from `a11y/package.json`       | Nothing                                                                                            |

Nx also tags a project whose `package.json` is private `npm:private` — `platform` and the two
`tools/` projects — and no rule names it. The `type:extension` rule cannot hold a customer library
to the six published entry points, because the project graph sees projects, not import
specifiers; `libs/platform/guardrails/check-extension-library.mjs` does, in
`beta:customer-guardrails`.

---

## 5. Where the four layers live

| Layer             | Code                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Configuration | `libs/shared/app-config`, `apps/nuxeo-ui/src/app/config/`, `nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/`, `nuxeo-agentic-core/src/main/resources/agentic-ui-config/`, `install.xml` |
| 1 — Declarative   | `libs/shared/extensions`, `apps/nuxeo-ui/src/app/extensions/`, `apps/nuxeo-satori-template/manifest.example.json`                                                                                  |
| 2 — Customer code | `libs/platform` (published), `libs/extensions/acme-extensions` (reference)                                                                                                                         |
| 3 — Harness       | `tools/satori-generators`, `libs/platform/guardrails/`, `libs/platform/AGENTS.md`                                                                                                                  |

---

## 6. Reading order for a new engineer

1. [`AGENTS.md`](../../AGENTS.md) — 30-second architecture
2. [`apps/nuxeo-ui/src/app/app.config.ts`](../../apps/nuxeo-ui/src/app/app.config.ts) — the
   composition root, and unusually well commented
3. [`apps/nuxeo-ui/src/app/app.routes.ts`](../../apps/nuxeo-ui/src/app/app.routes.ts) — the
   surface area, in one file
4. [`libs/shared/nuxeo-client/src/index.ts`](../../libs/shared/nuxeo-client/src/index.ts) —
   what the integration layer exposes
5. One feature end to end — `libs/features/browse` is representative and heavily commented
6. [`libs/shared/extensions/src/lib/extension-slots.ts`](../../libs/shared/extensions/src/lib/extension-slots.ts)
   — the customisation contract in 88 lines
