---
title: Technology Stack
parent: Engineering
order: 5
last_reviewed: 2026-10-14
repo_commit: d36176c
audience: engineering
---

# Technology Stack

> **Last reviewed:** 2026-10-14 · **Repository:** `d36176c`
> Only the version-pin rows and the registry section were re-verified at that commit, for
> NXSAT-637. Before that, the `@hylandsoftware/satori-ui` row at `d500aae` (NXSAT-308, #332); the rest of the page as of
> 2026-08-24 · `77265f9`.
> The repository link to `.npmrc` was made relative on 2026-10-08 at `2898046` (`feature/nxsat-308-ci-cold-cache-tooling`).
> Source: `package.json`, `pom.xml`, `nx.json`, `angular.json`. Where a choice has a recorded
> rationale, it is cited; where the rationale is not recorded, that is said.

---

## The matrix

| Technology                               | Version                | Purpose                                                | Where used                                       | Why chosen                                                                                                                                           |
| ---------------------------------------- | ---------------------- | ------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Angular**                              | ~22.2                  | Application framework                                  | Everywhere                                       | RFC positions the ageing Polymer Web UI as the problem; Angular is the framework the `nxs-` components are built on                                  |
| **TypeScript**                           | ~6.0, via Angular      | Language                                               | Everywhere                                       | Type safety is load-bearing — the `api-surface` gate exists to police public _types_                                                                 |
| **Nx**                                   | 23.3.0                 | Monorepo, task graph, affected calculation, generators | Workspace                                        | 26 projects with enforced boundaries and `affected` builds; generators are also the customer-facing Layer 3 mechanism                                |
| **RxJS**                                 | ~7.8                   | Async HTTP                                             | Services                                         | Angular's `HttpClient` is Observable-based                                                                                                           |
| **Angular signals**                      | 22.x                   | UI state                                               | Components                                       | Convention: `signal()` for mutable UI state, **never** `BehaviorSubject`. No global store                                                            |
| **`@hylandsoftware/satori-ui`**          | 1.0.0                  | Hyland design system                                   | `nuxeo-ui` only                                  | First-party design system. **Deliberately absent from the customer template** so a fork brings its own                                               |
| **Angular Material**                     | ~22.2                  | UI components                                          | `nuxeo-ui`, feature libs                         | The `nxs-` components are built on it. Not in the template                                                                                           |
| **`@ngx-translate/core`**                | 18.0.0                 | i18n                                                   | App + libs                                       | catalogues layer onto one loader, so the manifest's `labels` can override them                                                                       |
| **Vitest**                               | via `@nx/vitest`       | Unit tests                                             | 19 projects                                      | Fast. **Caveat: strips types through esbuild, so a green `test` is not type safety**                                                                 |
| **Playwright**                           | untracked, `--no-save` | E2E + evidence capture                                 | `nuxeo-ui-e2e`, `scripts/beta-harness`           | **Deliberately not a tracked dependency** so CI installs are not burdened with a browser download                                                    |
| **`@axe-core/playwright`**               | untracked, 4.14.0      | WCAG scanning                                          | `phase-6-a11y`                                   | Same reason. Absence is a **failed check**, never a silent skip. Pinned with `axe-core` 4.14.1, and any other pair is refused                        |
| **ESLint + `@nx/eslint-plugin`**         | 9.x                    | Lint + **module boundaries**                           | Workspace                                        | `enforce-module-boundaries` with real `depConstraints` is what makes the layer model enforceable                                                     |
| **Prettier**                             | 3.x                    | Formatting                                             | Workspace                                        | `docs/api/platform.api.md` is in `.prettierignore` — Prettier reformats fenced blocks and silently corrupted the snapshot                            |
| **Husky + lint-staged**                  |                        | Pre-commit                                             | Workspace                                        | ESLint `--fix` on `.ts`, Prettier on the rest                                                                                                        |
| **ng-packagr** via `@nx/angular:package` |                        | Builds the publishable package                         | `libs/platform`                                  | **`ng-packagr-lite` was tried and rejected** — it skips FESM bundling and produced 4 unresolvable subpaths                                           |
| **Quill**                                | ^2.0.3                 | Rich-text notes                                        | `note-editor`                                    | Note authoring. Current `npm audit`: **1 low (XSS)**                                                                                                 |
| **DOMPurify**                            | ^3.3.3                 | HTML sanitisation                                      | Notes, comments                                  | XSS defence where user HTML is rendered                                                                                                              |
| **`date-fns`** + Material adapter        | ^2.30, ~22.2           | Locale-aware date adapter                              | `libs/shared/ui` (`provideSatoriDateAdapter`)    | The Satori date adapter is built on `@angular/material-date-fns-adapter` and `date-fns` locales. A real dependency; NXSAT-672 relaxed the exact pins |
| **`dotenv`**                             | ^17.4.1                | Env loading                                            | Scripts                                          |                                                                                                                                                      |
| **`cors`**                               | ^2.8.6                 |                                                        | —                                                | See "unused" below                                                                                                                                   |
| **`tslib`, `zone.js`**                   |                        | Angular runtime                                        | Everywhere                                       | Required                                                                                                                                             |
| **Java + Maven**                         | 17+, 3.9+              | Marketplace package + OSGi bundle                      | `nuxeo-agentic-core`, `nuxeo-agentic-ui-package` | The deliverable is a Nuxeo marketplace package                                                                                                       |
| **Docker Compose**                       |                        | ARender, Mailpit                                       | Local dev                                        | Document viewer and local SMTP                                                                                                                       |
| **Nuxeo Server + OpenSearch**            | local, `:8080`         | The backend                                            | —                                                | The product this is a UI for                                                                                                                         |
| **ARender**                              | `${ARENDER_VERSION}`   | Rich document viewing                                  | Preview                                          | Licensed Arondor component                                                                                                                           |
| **Mailpit**                              | v1.22.3                | Local SMTP capture                                     | Permission notifications                         | Test email without a real relay                                                                                                                      |
| **GitHub Actions**                       |                        | CI + 7 automation workflows                            | `.github/workflows`                              |                                                                                                                                                      |
| **Node.js**                              | **24.x, pinned**       | Runtime                                                | Everything                                       | **Not optional** — Angular 22 needs Node 22.22.3+ or 24.15+, and Node 25+ shadows jsdom's `localStorage` and breaks specs on correct code            |

---

## Two unused production dependencies

`openai@^6.33.0` and `express@^5.2.1` are declared in `dependencies` and **imported nowhere** in
`apps`, `libs`, `scripts` or `tools`:

```bash
grep -rln "from 'openai'\|require('openai')" apps libs scripts tools    # → nothing
grep -rln "from 'express'\|require('express')" apps libs scripts tools  # → nothing
```

`cors` appears to be in the same category. They add weight to a **gated** lockfile and surface to
`npm audit` for no benefit. Removing them is trivial and should happen.

**Why this matters beyond tidiness:** `openai` in `dependencies` is the single most likely cause
of someone concluding this product makes direct LLM calls. It does not — see
[Runtime AI Features](10-runtime-ai-features.md).

---

## Registry configuration

[`.npmrc`](../../.npmrc) maps `@hylandsoftware` to GitHub Packages. The four packages resolved
from there are `@hylandsoftware/satori-ui` and the `satori-fonts`, `satori-icons` and
`satori-tokens` it depends on, so `SATORI_GH_READONLY_TOKEN` needs `read:packages` on the Hyland org only.

One rule:

- **`.npmrc` does not decide where CI fetches from — `package-lock.json` does.** `npm ci` installs
  from each entry's `resolved` URL and ignores the registry mapping. Change a scope's registry and
  you must regenerate the lock, or any claim about token scope is untested.

---

## Deliberate absences

| Not used                              | Why                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| NgRx / Redux                          | Signals + `providedIn: 'root'` services. No global store, by convention                                                                  |
| NgModules                             | `standalone: true` everywhere                                                                                                            |
| A CSS framework                       | Design system + theme tokens                                                                                                             |
| A general Markdown→Confluence library | The publisher is a small explicit converter — adding a package to a **gated** lockfile to handle syntax we do not use is the wrong trade |
| An agent framework / MCP server       | There is no agent runtime here. See [Skills, Agents & Generators](09-skills-agents-generators.md)                                        |
| Client-side caching                   | None. Every action hits Nuxeo — a known gap                                                                                              |
| APM / structured logging / metrics    | **None.** The largest operational gap                                                                                                    |
