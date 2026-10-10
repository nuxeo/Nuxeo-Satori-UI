---
title: Repository Guide
parent: Engineering
order: 3
last_reviewed: 2026-10-09
repo_commit: da80f15
audience: engineering
---

# Repository Guide

> **Last reviewed:** 2026-10-11 · **Repository:** `da80f15` (`feature/nxsat-308-toast`)
> Only the `satori-components` row of "Shared libraries" and the `libs/platform` row of "The other
> three" were re-verified at that commit; that heading's totals add the row to the 2026-08-24
> figures. `feature/nxsat-308-permissions-panel` recounted the `satori-components` row, with the
> permissions panel, on 2026-10-09. The rest of the page as of 2026-08-24 · `77265f9`:
> 992 tracked files · ~104k lines of TS/HTML/SCSS · ~20k lines of harness scripts ·
> ~20.5k lines of Markdown

An Nx monorepo with a Maven build layered on top of it, because the deliverable is a Nuxeo
marketplace package.

---

## 1. Top level

| Path                                                                                        | What it is                                                                                | Change it?                                                 |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`apps/`](../../apps)                                                                       | 3 Nx applications                                                                         | Yes                                                        |
| [`libs/`](../../libs)                                                                       | 23 Nx libraries — the bulk of the product                                                 | Yes                                                        |
| [`scripts/`](../../scripts)                                                                 | The development harness: gates, evidence, guardrails                                      | Carefully — see [Dev Harness](08-dev-harness-and-gates.md) |
| [`tools/`](../../tools)                                                                     | Nx generators + a vendored stub                                                           | Yes                                                        |
| [`AGENTS/`](../../AGENTS)                                                                   | 13-file agent knowledge base, 3,083 lines                                                 | Yes, and you must when behaviour changes                   |
| [`docs/`](../../docs)                                                                       | 29 documents, 12.9k lines. Several superseded — see the [index](../README.md)             | Yes                                                        |
| [`documentation/`](.)                                                                       | **This** documentation set, published to Confluence                                       | Yes                                                        |
| [`.cursor/`](../../.cursor)                                                                 | 13 Cursor rules + 13 skills                                                               | Yes                                                        |
| [`.claude/`](../../.claude)                                                                 | 2 review subagent definitions                                                             | Yes                                                        |
| [`.ai/state/`](../../.ai/state)                                                             | `phases.json`, `coverage-baseline.json` — gated machine state                             | Only through the gates                                     |
| [`.github/`](../../.github)                                                                 | 8 workflows, PR template, dependabot, Copilot instructions                                | Yes                                                        |
| [`nuxeo-agentic-core/`](../../nuxeo-agentic-core)                                           | Java/OSGi bundle, 189 lines — URL codec, auth + login contributions                       | Rarely                                                     |
| [`nuxeo-agentic-ui-package/`](../../nuxeo-agentic-ui-package)                               | The marketplace package: `install.xml`, `package.xml`, assembly                           | **Escalate first** — a hard stop in the phase skill        |
| [`nuxeo-conf/`](../../nuxeo-conf)                                                           | Server-side Nuxeo config fragments for local dev                                          | Yes                                                        |
| `pom.xml`                                                                                   | Maven parent — modules: `apps/nuxeo-ui`, `nuxeo-agentic-core`, `nuxeo-agentic-ui-package` | Rarely                                                     |
| `angular.json`, `nx.json`, `tsconfig.base.json`, `eslint.config.mjs`, `vitest.workspace.ts` | Workspace configuration                                                                   | Carefully                                                  |
| `*-docker-compose.yml`, `nginx-arender-proxy.conf`, `.env.arender.example`                  | ARender and Mailpit for local dev                                                         | Yes                                                        |
| `CLAUDE.md`, `AGENTS.md`, `.windsurfrules`                                                  | Tool adapters onto `AGENTS/`                                                              | Yes                                                        |
| `README.charter.md`, `NUXEO_MARKETPLACE_GUIDE.md`                                           | Charter and packaging guide                                                               | Rarely                                                     |

### Deliberately excluded from documentation

`node_modules/`, `dist/`, `coverage/`, `.angular/`, `.nx/`, `tmp/`, `test-results/`,
`package-lock.json` (12k+ lines of generated resolution), `.DS_Store`. These are generated
or vendored and carry no engineering intent — with two exceptions worth knowing:

- **`package-lock.json` is load-bearing** despite being generated. See the `npm ci` warning
  in [Getting Started](01-getting-started.md#use-npm-ci-never-a-bare-npm-install).
- **`tools/stubs/ng-mocks`** is a hand-written stub, not vendored code. It replaces the real
  `ng-mocks` because adf-hx imports a **test library from its shipped runtime bundle**,
  which put `ng-mocks`' implementation and two `eval()` calls into a customer-facing chunk.
  The stub is why `npm run beta:bundle` now reports 0 `eval()`.

---

## 2. Applications

| App                                                              |  Lines | Purpose                                                                                 |
| ---------------------------------------------------------------- | -----: | --------------------------------------------------------------------------------------- |
| [`apps/nuxeo-ui`](../../apps/nuxeo-ui)                           | 13,257 | **The product.** Shell, routing, auth, theme, i18n, settings, dashboard, administration |
| [`apps/nuxeo-satori-template`](../../apps/nuxeo-satori-template) |  2,652 | **The forkable customer template.** Ships no design system on purpose                   |
| [`apps/nuxeo-ui-e2e`](../../apps/nuxeo-ui-e2e)                   |    453 | Playwright E2E — 12 specs, 4 critical paths                                             |

### `apps/nuxeo-ui` — what lives directly in the app rather than a library

Anything that is inherently _the shell_ and would be wrong to make reusable:

| Directory                                   | Responsibility                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/app/auth/`                             | `AuthService`, `authGuard`, `loginGuard`, `adminGuard`, the HTTP interceptor, session timeout, share tokens |
| `src/app/config/`                           | `provideAppConfig()` — the Layer 0 loader wiring                                                            |
| `src/app/extensions/`                       | `provide-app-extensions.ts` — the app's Layer 1 registrations, incl. the 12 packaged `documentList` columns |
| `src/app/shell/`                            | App shell, nav drawer                                                                                       |
| `src/app/theme/`                            | `AppThemeService`                                                                                           |
| `src/app/i18n/`                             | `AppTranslateLoader` — seeds adf-core and adf-hx catalogues                                                 |
| `src/app/dashboard/`, `settings/`, `login/` | Shell-level pages                                                                                           |

### `apps/nuxeo-satori-template` — why it exists and why it is bare

It is what a customer forks. It deliberately ships **no Angular Material and no Satori design
system**, so a fork does not have to remove ours before adding theirs. Consequence:
`--mat-sys-*` tokens are undefined there, which is why `--shell-*` is a recognised themed
namespace in the guardrails rather than a faked one.

It also carries the reference Layer 0/1/2 customisation the upgrade rehearsal stages:
`public/agentic-ui-config/bootstrap.json`, `manifest.example.json`,
`src/app/extensions/template-extensions.ts`, and it consumes
[`libs/extensions/acme-extensions`](../../libs/extensions/acme-extensions).

---

## 3. Libraries

### Feature libraries — 9, 53,580 lines

**They never import each other.** Enforced by `depConstraints`.

| Library               |  Lines | Specs |                        Coverage |
| --------------------- | -----: | ----: | ------------------------------: |
| `document-detail`     | 12,679 |     4 |                           29.8% |
| `browse`              | 12,050 |     4 |                           56.7% |
| `administration`      |  7,346 |     3 |                           62.1% |
| `search`              |  5,172 |     1 |                           22.8% |
| `knowledge-discovery` |  3,918 |     3 |                           64.8% |
| `tasks`               |  3,515 | **0** |     _reported 100% — see below_ |
| `assets`              |  3,381 | **0** |     _reported 100% — see below_ |
| `trash`               |  2,866 | **0** | not measured (no `test` target) |
| `collections`         |  2,653 |     1 |                           81.7% |

> **The 100% figures for `tasks` and `assets` are artefacts.** Both have zero spec files;
> their coverage reports contain 0 total statements, so the summariser computes 0/0 as 100%.
> `core` has the same shape. Of 17 measured projects, 6 read as ≥90% and **3 genuinely are**.

### Shared libraries — 12, 47,241 lines

| Library              |  Lines | Specs | Responsibility                                                                                                                   |
| -------------------- | -----: | ----: | -------------------------------------------------------------------------------------------------------------------------------- |
| `nuxeo-client`       | 14,483 |    29 | **The integration layer.** 25 services, models, utils. Everything that talks to Nuxeo                                            |
| `adf-hx-bridge`      |  8,380 |    12 | **The only place adf-hx types may appear.** 12 API port implementations, HXQL escaping                                           |
| `ui`                 |  4,741 |     4 | Shared presentational components. **Published** as `@nuxeo-satori/platform/ui`                                                   |
| `extensions`         |  3,101 |     9 | The 4 registries, rules, `provideSatoriExtensions`. **Published**                                                                |
| `kd-client`          |  2,172 |     3 | Knowledge Discovery client                                                                                                       |
| `permission-dialogs` |  1,822 |     3 | The 4 permission/sharing dialogs — moved here 2026-08-24 from `features/collections`                                             |
| `document-layouts`   |  2,262 |     5 | Per-type Properties-panel layouts: a package's layout file, or generated from the type's schemas (NXSAT-311; counted 2026-10-07) |
| `app-config`         |  1,620 |     4 | Layer 0 loader. **Published**                                                                                                    |
| `ke-client`          |    734 |     1 | Knowledge Enrichment client                                                                                                      |
| `ai-client`          |    457 | **0** | The 12 `AI.*` operations. Thin HTTP client                                                                                       |
| `util`               |    108 |     0 | Small helpers                                                                                                                    |
| `satori-components`  |  7,361 |    12 | The `nxs-` components replacing adf-hx. **Published** as `@nuxeo-satori/platform/components` (NXSAT-308; counted 2026-10-11)     |

### The other three

| Library                                                                    | Purpose                                                                                                                                                  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`libs/platform`](../../libs/platform)                                     | `@nuxeo-satori/platform` — the publishable package. Owns nothing; wraps 5 shared libs as entry points, ships docs, generators and the customer guardrail |
| [`libs/core`](../../libs/core)                                             | 233 lines of primitives                                                                                                                                  |
| [`libs/extensions/acme-extensions`](../../libs/extensions/acme-extensions) | The **reference customer** Layer 2 library — 7 registered IDs. Also the subject of `beta:customer-guardrails`                                            |

### Why `permission-dialogs` is not in `shared/ui`

`libs/shared/ui` is a **published** entry point (`@nuxeo-satori/platform/ui`). Putting the
four dialogs there would have added eight symbols to the customer-facing API for components
that are internal application UI. Once a customer can import a name, renaming it is a
breaking change. `document-layouts` is kept out of the published entry points for the same
reason: its layout-file format is the customer contract, not its classes.

---

## 4. Nx project tags

Every project carries `scope:` and `type:`. **An untagged project cannot depend on anything**
— a new library needs tags before it can import.

| Tag                                 | Projects                            |
| ----------------------------------- | ----------------------------------- |
| `scope:features`                    | the 9 feature libs                  |
| `scope:shared`                      | the 10 shared libs, plus `platform` |
| `scope:core`                        | `core`                              |
| `scope:app`                         | `nuxeo-ui`                          |
| `scope:template`                    | `nuxeo-satori-template`             |
| `scope:customer` / `type:extension` | `acme-extensions`                   |
| `scope:e2e` / `type:e2e`            | `nuxeo-ui-e2e`                      |
| `type:publishable`                  | `platform`                          |

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
   — the customisation contract in 60 lines
