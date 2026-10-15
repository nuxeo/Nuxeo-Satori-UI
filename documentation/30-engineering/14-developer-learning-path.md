---
title: Developer Learning Path (No-Agent)
parent: Engineering
order: 14
last_reviewed: 2026-10-15
repo_commit: c053e63
audience: engineering
---

# Developer Learning Path — Building This Application Without AI Agents

> **Last reviewed:** 2026-10-15 · **Repository:** `c053e63` (`integration/nxsat-308`)
> Only the adf-hx bridge and POC-route passages were re-verified at that commit, for NXSAT-648.
> Before that, last reviewed 2026-10-14 at `d36176c` (`feature/nxsat-308-remove-adf-packages`):
> Only the package table and the authentication paragraph in §16, the `import type` line in §2, the
> version-pin rows in §18 and the ADF rows in Appendix A were re-verified at that commit, for
> NXSAT-637. On
> 2026-10-08 at `5abcd50` (`feature/nxsat-308-replace-adf-extensions`) the
> `@alfresco/adf-extensions` lines in §15 and §16 and the platform version in §19 were
> re-verified, and only §22.2, the local gate list, at `fb97d44`
> (`feature/nxsat-308-dependency-tree-gate`), and the `@hylandsoftware/satori-ui` row at
> `d500aae` (`feature/nxsat-308-satori-ui-0-2-1`). The Angular and `dompurify` rows were re-verified on
> 2026-10-05 at `b15d9cf` (`fix/nxsat-303-production-advisories`) — see Appendix A.
> **Purpose:** the complete list of technologies, versions and concepts a developer must know to
> build, extend and operate Nuxeo Satori **by hand**, with no AI assistance of any kind.
> **Sources:** `package.json`, `package-lock.json`, `pom.xml`, `nx.json`, `angular.json`,
> `eslint.config.mjs`, `apps/**`, `libs/**`, `scripts/**`, `.github/workflows/**`, `AGENTS/**`.

---

## 0. How to read this document

This is not a reading list of nice-to-haves. Every topic below is here because **something in
this repository will not compile, will not run, or will silently misbehave if you do not know it**.
Where a topic is optional, it says so.

Versions are the versions **actually resolved in `package-lock.json`**, not the semver ranges in
`package.json`. Where the two differ the range is given in brackets, because that is what you will
see when you open `package.json` and wonder why the docs disagree.

Each module carries three markers:

| Marker     | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| **Must**   | You cannot work in this repository without it.                      |
| **Should** | You will be blocked within your first month without it.             |
| **Area**   | Only needed if you work in that specific area; skippable otherwise. |

**Effort figures assume a working developer, not a beginner.** They are hours of deliberate study
plus hands-on practice, not calendar time. A realistic total for someone with prior Angular
experience is **12–14 weeks part-time**; for someone coming from React or from Angular 8-era
NgModules, **20–24 weeks**. The schedule in §20 sequences that.

A caution about one thing this document deliberately does _not_ do: it does not teach you the
codebase. It teaches you the **technologies the codebase is made of**. The codebase itself is
covered by [Codebase Reference](04-codebase-reference.md) and [Code KT](11-code-kt.md), and by the
`AGENTS/` knowledge base in the repository root. Read those alongside Part IV onwards.

---

## Part I — Foundations

### 1. Node.js and the JavaScript runtime — **Must**

| Item    | Version                                                    | Notes                             |
| ------- | ---------------------------------------------------------- | --------------------------------- |
| Node.js | **20.x, pinned** (`.nvmrc` = `20`, `engines.node: "20.x"`) | Not a preference. Not negotiable. |
| npm     | **11.6.2** (`packageManager` field)                        | Corepack-managed.                 |

**Why the pin is load-bearing.** On Node 22 and above a built-in global `localStorage` shadows
jsdom's implementation, and unit tests fail against perfectly correct code. `npm run beta:gate`
works around it; a bare `nx test` does not. The `node` gate in the beta harness exists solely to
turn "mysterious spec failures" into "you are on the wrong Node".

Topics: ES2022 modules vs CommonJS (this repo is `"module": "preserve"` and mixes both — Angular
code is ESM, the `scripts/**` tooling is `.mjs`), `package.json` fields (`exports`, `sideEffects`,
`peerDependencies`, `overrides`), semver ranges (`~` vs `^` vs exact), lockfile semantics.

- [Node 20 API docs](https://nodejs.org/docs/latest-v20.x/api/)
- [npm `package.json` reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
- [Node ESM/CJS interop](https://nodejs.org/api/esm.html)

**Two lockfile facts you must internalise before you ever run an install:**

1. **Never run a bare `npm install` on macOS and commit the lockfile.** It prunes optional
   platform entries that Linux needs (specifically `@oxc-resolver/binding-wasm32-wasi`'s nested
   `@emnapi/*` entries) and `npm ci` on CI then refuses the tree.
2. **`npm ci` installs from each entry's `resolved` URL, not from `.npmrc`.** Repointing a scope's
   registry does nothing until the lock is regenerated.

Estimated effort: **6 hours** if you have used Node; **20 hours** if not.

---

### 2. TypeScript 5.8 — **Must**

Resolved version: **5.8.3** (`~5.8.0`).

This repository runs TypeScript at close to maximum strictness, and the settings are not decorative
— they are why the published API surface can be gated. From `tsconfig.json`:

`strict`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `isolatedModules`, plus `angularCompilerOptions` with
`strictTemplates`, `strictInjectionParameters`, `strictInputAccessModifiers`.

Topics you will actually hit:

- Structural typing, discriminated unions, `unknown` vs `any`, type narrowing and type guards
- Generics, conditional types, mapped types, `satisfies`
- `noPropertyAccessFromIndexSignature` — you must write `obj['key']` for index signatures. This
  affects every `process.env['X']` and every Nuxeo `properties['dc:title']` access in the codebase.
- Declaration files (`.d.ts`) and what "public API surface" means — the `beta:api` gate diffs the
  emitted `.d.ts` against `docs/api/platform.api.md`
- `import type` and why it matters for bundle size (`@alfresco/js-api` was a devDependency
  precisely because it was types-only, avoiding 7 MB at runtime, until NXSAT-637 removed it)
- Path mapping (`tsconfig.base.json` holds 25 path aliases across two scopes)

- [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [`tsconfig` reference](https://www.typescriptlang.org/tsconfig)
- [TypeScript 5.8 release notes](https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/)
- [Type-level exercises (excellent, free)](https://github.com/type-challenges/type-challenges)

Estimated effort: **25 hours**.

---

### 3. Modern CSS and Sass — **Must**

Sass resolved: **1.102.0** (`^1.98.0`). `inlineStyleLanguage: scss` in `angular.json`.

`apps/nuxeo-ui/src/styles.scss` is roughly 400 lines and is the single best worked example of the
theming layer. You need:

- Sass modules — `@use` / `@forward` (the repo uses `@use '@angular/material' as mat` and
  `@use '@hylandsoftware/satori-ui/theme' as sat`); `@import` is deprecated and not used
- Mixins, functions, maps, `@each`
- **CSS custom properties as an API.** This is the Layer 0 customer seam: `--mat-sys-*`,
  `--sat-tag-*`, `--hxp-*`, `--agentic-pill-*`. `apps/nuxeo-ui/src/styles/hxp-theme.scss` defines a
  `tokens-from-satori()` mixin that aliases `--mat-sys-*` onto `--hxp-*` so bridge components
  consume only `--hxp-*` and never reach into Material directly.
- `color-mix(in srgb, ...)`, `color-scheme: light dark`, `:host`, `::ng-deep` and view encapsulation
- **Specificity as a design decision.** The styles file carries extensive commentary on why
  overriding a third-party component with higher specificity is correct and `!important` is not:
  `!important` is unoverridable by the customer, which defeats Layer 0.

- [Sass documentation](https://sass-lang.com/documentation/)
- [MDN CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties)
- [MDN `color-mix()`](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/color-mix)
- [Angular view encapsulation](https://angular.dev/guide/components/styling)

Estimated effort: **15 hours**.

---

### 4. Web platform APIs used in this codebase — **Must**

Only learn the ones that are actually here. This list is exhaustive, verified by grepping `libs/`
and `apps/`:

| API                                              | Where                                                                                                | Why it matters                                                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch` / `XMLHttpRequest`                       | Behind `HttpClient`                                                                                  | You rarely touch it directly; the interceptor does.                                                                                                                 |
| `Blob`, `URL.createObjectURL`, `revokeObjectURL` | `document-detail` (24 create / 25 revoke), `browse` (17/18), `collections` (5/4), `ui`               | **The single most common bug source in this repo.** Every created URL must be tracked and revoked in `ngOnDestroy`.                                                 |
| `FormData` (multipart)                           | `nuxeo-client` (10 sites), `ke-client` (6)                                                           | Batch upload and Knowledge Enrichment blob posts.                                                                                                                   |
| `localStorage` / `sessionStorage`                | `browse` (24), `nuxeo-client` clipboard (8), `ai-client` flags (6), `extensions`, `search`, `assets` | Session persistence, column settings, feature flags. Note the app stores its session in **`sessionStorage`**, which is why Playwright `storageState` does not work. |
| `ResizeObserver`                                 | `browse` (7), `document-detail` (2), `collections` (2)                                               | jsdom has none — every test setup stubs it.                                                                                                                         |
| Canvas 2D (`getContext('2d')`)                   | `document-detail` (1 site)                                                                           | Image handling.                                                                                                                                                     |
| `navigator.clipboard`                            | `libs/shared/ui`                                                                                     | Copy-link actions.                                                                                                                                                  |
| `requestAnimationFrame`                          | `document-detail` (2)                                                                                | Layout timing.                                                                                                                                                      |
| Custom URL schemes (`nxdrive://`)                | `NuxeoDriveService`                                                                                  | Launching the desktop sync client.                                                                                                                                  |

**Explicitly not used anywhere in `libs/` or `apps/`, so do not spend time on them:** Web Workers,
IndexedDB, Service Workers, WebSocket, `EventSource`/SSE, `IntersectionObserver`,
`MutationObserver`, `AbortController`. If you see a tutorial insisting these are essential Angular
skills, they are not essential _here_.

- [MDN Web APIs index](https://developer.mozilla.org/en-US/docs/Web/API)
- [MDN `URL.createObjectURL` (read the memory-management section twice)](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static)

Estimated effort: **10 hours**.

---

## Part II — The framework

### 5. Angular 20.3 — **Must** (the largest single module)

Resolved: **20.3.33** across `@angular/core`, `common`, `router`, `forms`, `compiler`,
`animations`, `platform-browser`, `platform-browser-dynamic` (`~20.3.33`). CLI and build tooling
also 20.3.x. `zone.js` **0.15.1**.

Angular 20 is a genuinely different framework from Angular 8–14. If your Angular knowledge predates
standalone components and signals, treat this as learning a new framework, not an upgrade.

#### 5.1 What this repo uses — and what it deliberately does not

| Feature                                                                     | Used here?                                                                                       | Note                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Standalone components (`standalone: true`)                                  | **Everywhere**                                                                                   | Zero NgModules. `importProvidersFrom` appears exactly once, for `TranslateModule.forRoot()`. |
| `inject()` for DI                                                           | **Everywhere**                                                                                   | Constructor-parameter DI is banned by convention.                                            |
| Signals (`signal`, `computed`, `effect`, `untracked`, `linkedSignal`)       | **Everywhere**                                                                                   | ~300 `signal()` calls across features. `BehaviorSubject` for UI state is banned.             |
| `toSignal()` / `toObservable()`                                             | Yes                                                                                              | `features/search` is the only place using both directions.                                   |
| `takeUntilDestroyed()`                                                      | **Mandatory on every `.subscribe()`**                                                            | ~200 sites.                                                                                  |
| External templates (`templateUrl`)                                          | **Always**                                                                                       | Inline templates are banned by convention.                                                   |
| Functional guards (`CanActivateFn`)                                         | Yes — `authGuard`, `loginGuard`, `adminGuard`, `themingGuard`, plus three in `nuxeo-client/auth` | Class-based guards are not used.                                                             |
| Functional interceptors (`HttpInterceptorFn`)                               | Yes — one, `nuxeoAuthInterceptor`                                                                | Class-based interceptors are not used.                                                       |
| `provideRouter` with `withHashLocation()` and `withComponentInputBinding()` | Yes                                                                                              | Routes are `/#/browse`. See the trap below.                                                  |
| Lazy loading (`loadComponent`, `loadChildren`)                              | Heavily — 8 feature libraries plus ~12 app-local pages                                           |                                                                                              |
| `APP_INITIALIZER`                                                           | Yes, twice in `nuxeo-ui`                                                                         | The template app uses the modern `provideAppInitializer` instead. Know both.                 |
| Angular Material + CDK                                                      | Yes, ~25 modules per large feature                                                               |                                                                                              |
| Route resolvers                                                             | **No**                                                                                           | Data loading happens in components via signals.                                              |
| Zoneless change detection                                                   | **No**                                                                                           | `zone.js` is explicitly imported in `main.ts`; adf-core reaches `NgZone`.                    |
| SSR / hydration                                                             | **No**                                                                                           | Browser-only `@angular/build:application`.                                                   |
| `resource()` / `httpResource()`                                             | **No**                                                                                           | Angular 20's newer async primitives are not adopted.                                         |
| Reactive Forms                                                              | Yes                                                                                              | Template-driven forms are marginal.                                                          |

**The `withHashLocation()` trap, worth knowing on day one:** because routing is hash-based,
`page.goto('/#/x')` is a _same-document_ navigation. `APP_INITIALIZER` does not re-run. Any test or
evidence capture that claims to exercise a _reloaded_ application needs a real `page.reload()`.

**The `APP_INITIALIZER` concurrency trap:** initializer functions run **concurrently**, not in
sequence. Anything that must happen once, in order, has to be sequenced _inside_ a single
initializer. `apps/nuxeo-ui/src/app/config/provide-app-config.ts` shows the pattern.

#### 5.2 Sub-topics, in learning order

1. Components, templates, the new control flow (`@if`, `@for`, `@switch`, `@defer`), `track`
2. Signals in depth — `signal`, `computed`, `effect`, `untracked`, signal-based `input()` /
   `output()` / `viewChild()` / `contentChild()`, and when an `effect` is the wrong tool
3. Dependency injection — `inject()`, `InjectionToken`, `providedIn: 'root'`, hierarchical
   injectors, `provide*` factory functions. **DI tokens are this codebase's configuration seam**:
   `NUXEO_API_ORIGIN`, `CURRENT_USERNAME`, `ARENDER_CONFIG`, `AI_BACKEND_URL`, `KD_CIC_OPERATIONS`,
   `ADMIN_ACCESS_CHECKS`, and the twelve adf-hx API tokens.
4. `HttpClient` — `provideHttpClient(withInterceptors([...]))`, `HttpContext` and
   `HttpContextToken` (used for `NUXEO_ESTABLISH_BROWSER_SESSION`), `HttpParams`, `responseType`,
   progress events
5. Router — `provideRouter`, route configuration, lazy loading, guards, `ActivatedRoute`,
   `paramMap` vs `snapshot` (**always the observable when a component can be reused**),
   `withComponentInputBinding()`, `UrlTree` returns from guards
6. Lifecycle — `ngOnInit`, `ngOnDestroy`, `DestroyRef`, `afterNextRender`
7. Change detection — `OnPush`, how signals interact with it, why `zone.js` is still present
8. Reactive Forms — `FormControl`, `FormGroup`, `FormArray`, validators, `valueChanges`
9. Content projection, `ng-template`, `ngTemplateOutlet`, dynamic components
10. Pipes, including the fact that **adf-core injects pipes as services**, so `DecimalNumberPipe`,
    `LocalizedDatePipe` and `FileSizePipe` must be explicitly provided or you get `NG0201`

- [Angular official docs (start here, they were rewritten for the modern API)](https://angular.dev/)
- [Signals guide](https://angular.dev/guide/signals)
- [RxJS interop (`toSignal`, `toObservable`, `takeUntilDestroyed`)](https://angular.dev/ecosystem/rxjs-interop)
- [Dependency injection](https://angular.dev/guide/di)
- [Routing](https://angular.dev/guide/routing)
- [`HttpClient` and interceptors](https://angular.dev/guide/http)
- [Angular 20 release notes](https://blog.angular.dev/announcing-angular-v20-b793248fbbf7)
- [Error reference (bookmark `NG0201`, `NG0908`, `NG0100`)](https://angular.dev/errors)

Estimated effort: **70 hours** if you know Angular 15+; **120 hours** otherwise.

---

### 6. Angular Material 20 and the CDK — **Must**

Resolved: `@angular/material` **20.2.14**, `@angular/cdk` **20.2.14**, plus
`@angular/material-date-fns-adapter` **20.2.14** and `@mat-datetimepicker/core` **16.0.1**.

Material is not a choice here — adf-core imports it at 48 sites, so it is unavoidable in
`nuxeo-ui`. It is deliberately **absent** from `apps/nuxeo-satori-template`, which hand-rolls SCSS,
because a customer fork must be able to bring its own design system.

Components you will meet (each large feature imports 20–25 modules): dialog, table, paginator,
sort, form-field, input, select, autocomplete, chips, datepicker, menu, tabs, tree, snack-bar,
tooltip, expansion, sidenav, toolbar, progress-bar/spinner, slide-toggle, radio, checkbox, button,
icon, list, card, badge, divider, stepper.

CDK usage is narrow: only `@angular/cdk/keycodes`, in `features/administration`. **No overlay, no
drag-drop, no virtual scroll anywhere in `libs/`** — do not spend time on them.

Theming is the part that takes the time: `mat.$azure-palette` / `$rose-palette`, `mat.theme()`,
system tokens (`--mat-sys-*`), and the four themes selected by
`html[data-app-theme='nuxeo'|'dark'|'kawaii'|'light']`.

- [Angular Material components + theming](https://material.angular.dev/)
- [Material 3 theming guide](https://material.angular.dev/guide/theming)
- [Angular CDK](https://material.angular.dev/cdk/categories)

Estimated effort: **20 hours**.

---

### 7. RxJS 7.8 — **Must**

Resolved: **7.8.2** (`~7.8.0`).

Signals own UI state; RxJS owns everything async and HTTP. Both, always. The operator set in
active use, counted across `libs/`:

- **Promise bridging: `firstValueFrom`** — 324 uses in `nuxeo-client`, 114 in `adf-hx-bridge` (removed since, NXSAT-635),
  59 in `kd-client`. This is the dominant idiom in the data layer, so learn it first.
- `switchMap` (59 in `nuxeo-client`, 16 in `knowledge-discovery` for answer polling), `concatMap`,
  `mergeMap`
- `catchError` (46), `forkJoin` (20+), `combineLatest`, `shareReplay` (5), `defer`, `timer`,
  `debounceTime` (autocompletes), `map`, `filter`, `tap`, `finalize`, `of`, `throwError`
- **`expand()`** — three uses, walking Nuxeo's paginated endpoints. Unusual enough that most RxJS
  tutorials skip it; you need it.
- `takeUntilDestroyed()` — the Angular interop operator, mandatory on every subscription

Concepts: cold vs hot, subscription lifecycle and leaks, error handling and why an error terminates
a stream, higher-order mapping and the difference between `switchMap` and `mergeMap` (race
conditions in this app are almost always the wrong one), multicasting.

- [RxJS official docs](https://rxjs.dev/guide/overview)
- [Operator decision tree](https://rxjs.dev/operator-decision-tree)
- [Learn RxJS (per-operator examples with marble diagrams)](https://www.learnrxjs.io/)

Estimated effort: **25 hours**.

---

## Part III — Repository, build and quality tooling

### 8. Nx 22 monorepo — **Must**

Resolved: **22.7.8** across `nx`, `@nx/angular`, `@nx/eslint`, `@nx/eslint-plugin`, `@nx/js`,
`@nx/vite`, `@nx/vitest`, `@nx/workspace`.

27 projects: 3 apps, 22 libraries, plus two untagged support projects.

Topics:

- Project graph, `project.json` targets, `targetDefaults`, `dependsOn: ["^build"]`
- Caching and `namedInputs` (the `production` input excludes spec files)
- `nx affected` and how the SHA range is computed (`nrwl/nx-set-shas@v4` in CI)
- **Project tags and `@nx/enforce-module-boundaries` `depConstraints`** — this is the mechanism
  that makes the four-layer architecture real rather than aspirational

The tag matrix, from `eslint.config.mjs`:

| sourceTag          | may depend on                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `type:app`         | `type:feature`, `type:ui`, `type:data-access`, `type:util`, `type:extension`, `type:publishable` |
| `scope:features`   | `scope:shared`, `scope:core`                                                                     |
| `scope:shared`     | `scope:shared`, `scope:core`                                                                     |
| `scope:core`       | `scope:core`                                                                                     |
| `type:extension`   | `type:publishable`, `scope:shared`                                                               |
| `type:publishable` | `scope:shared`, `scope:core`                                                                     |

**An untagged project can depend on nothing.** A new library needs tags before it can import
anything.

Two traps recorded in the repository, both of which cost real time:

1. Until 2026-08-24 the constraint was Nx's scaffolded `sourceTag: '*' → onlyDependOnLibsWithTags: ['*']`,
   which permits every edge. The rule was severity `error` the entire time and had **never rejected
   anything**; four violations accumulated, including a `libs/shared/` library depending on two
   feature libraries. A rule you have not seen fail is not a rule.
2. The `@nx/eslint/plugin` entry sets `targetName: 'eslint:lint'`, and `nx affected -t lint` does
   **not** match `eslint:lint`. Six projects were silently never linted. Every `project.json` now
   declares an explicit `lint` target with a comment saying why.

A documented limitation you must know before designing anything around it: tag constraints see
**projects, not import specifiers**, so they cannot distinguish `@nuxeo-satori/platform/extensions`
from a raw `@agentic-ui/shared-extensions` — both are the same graph edge. That guarantee is
enforced separately by `libs/platform/guardrails/check-extension-library.mjs`.

- [Nx documentation](https://nx.dev/getting-started/intro)
- [Enforce module boundaries](https://nx.dev/features/enforce-module-boundaries)
- [Nx Angular plugin](https://nx.dev/nx-api/angular)
- [`nx affected`](https://nx.dev/ci/features/affected)

Estimated effort: **20 hours**.

---

### 9. The Angular build system — **Must**

| Tool                         | Version                                                              | Role                                                   |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| `@angular/build:application` | 20.3.x                                                               | The esbuild/Vite application builder. **Not webpack.** |
| `@angular/build:dev-server`  | 20.3.x                                                               | `nx serve nuxeo-ui` → `http://localhost:4200`          |
| Vite                         | **6.4.3** (pinned via `overrides` under both Angular build packages) | Underlies both the builder and Vitest                  |
| esbuild                      | **0.28.1** (pinned via `overrides`)                                  |                                                        |
| ng-packagr                   | **20.3.2**                                                           | Builds the one publishable library                     |

Topics: builder configuration in `angular.json`, `inlineStyleLanguage`, asset globs (this app pulls
assets from five `node_modules` locations for adf-core, adf-hx and Satori i18n), `outputHashing`,
`inlineCritical`, `--base-href` (production builds under `/nuxeo/agentic-ui/`), and **budgets**.

Budgets differ per app and the difference is the lesson:

| App                     | initial warn / error | Why                                                                                                |
| ----------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `nuxeo-ui`              | 2.5 MB / 4 MB        | adf-core is eager; measured 1.71 MB → 2.86 MB after the ports and document-list swap               |
| `nuxeo-satori-template` | **450 kB / 700 kB**  | A customer fork that stays on the published entry points should be small, and the budget proves it |

There are **no `src/environments/` files**. Environment-specific values come from the Layer 0
`bootstrap.json` fetched at runtime, not from Angular `fileReplacements`. This is a genuinely
different mental model from stock Angular and is the thing most new joiners get wrong first.

Dev-server proxying is three files: `proxy.conf.json` (Nuxeo on `:8080`, the default),
`proxy.conf.local.json` (Nuxeo on `:8090` plus an AI backend on `:3100` with 600 s timeouts), and
`proxy.conf.beta.json` (the hosted beta). All three inject `X-NXproperties: *`.

- [Angular build system guide](https://angular.dev/tools/cli/build)
- [Build configuration reference](https://angular.dev/reference/configs/workspace-config)
- [Dev-server proxy](https://angular.dev/tools/cli/serve#proxying-to-a-backend-server)
- [Vite](https://vite.dev/guide/)

Estimated effort: **12 hours**.

---

### 10. Linting, formatting and commit hygiene — **Must**

| Tool                     | Version                  |
| ------------------------ | ------------------------ |
| ESLint                   | **9.39.5** (flat config) |
| `typescript-eslint`      | 8.x                      |
| `angular-eslint`         | 20.x                     |
| `eslint-config-prettier` | 10.x                     |
| Prettier                 | **3.9.6**                |
| Husky                    | **9.1.7**                |
| lint-staged              | **16.4.0**               |

Topics: ESLint 9 **flat config** (`eslint.config.mjs`, not `.eslintrc`), composing shareable
configs, per-project overrides, Angular template linting, custom rule severity.

Husky hooks, all three of which will run on you:

- `pre-commit` → `npx lint-staged` (ESLint `--fix` + Prettier on `.ts`; Prettier on
  `.html`, `.scss`, `.json`, `.md`)
- `commit-msg` → `node scripts/strip-bot-coauthors.mjs`
- `pre-push` → `npm run review:guardrails`

Commit convention: **Conventional Commits**, enforced downstream by `conventional-changelog` in the
`changelog.yml` workflow. Branches are `feature/*`, `fix/*`, `docs/*`, `refactor/*`. Never commit
to `main`.

- [ESLint flat config](https://eslint.org/docs/latest/use/configure/configuration-files)
- [typescript-eslint](https://typescript-eslint.io/getting-started)
- [angular-eslint](https://github.com/angular-eslint/angular-eslint)
- [Prettier](https://prettier.io/docs/en/)
- [Husky](https://typicode.github.io/husky/)
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)

Estimated effort: **8 hours**.

---

### 11. Unit testing — Vitest, jsdom, Analog — **Must**

| Tool                                                        | Version    |
| ----------------------------------------------------------- | ---------- |
| Vitest                                                      | **3.2.7**  |
| `@vitest/coverage-v8`, `@vitest/ui`                         | 3.2.7      |
| jsdom                                                       | **28.1.0** |
| `@analogjs/vite-plugin-angular`, `@analogjs/vitest-angular` | **1.22.5** |

19 libraries each have a `vite.config.mts` and a `src/test-setup.ts`. Vitest is the real runner.
Karma and Jasmine are still in `devDependencies` and `angular.json` declares a
`@angular/build:karma` target for `nuxeo-ui`, but that path is **vestigial** — libraries are 100%
Vitest.

Topics: Vitest API (`describe`, `it`, `expect`, `vi.fn`, `vi.spyOn`, `vi.mock`), Angular `TestBed`,
`ComponentFixture`, `HttpTestingController`, harnesses, fake timers, coverage with the v8 provider.

Four things in every `test-setup.ts` that you must understand rather than copy:

1. `import '@angular/compiler'` — JIT compilation in tests
2. `import '@analogjs/vitest-angular/setup-zone'` — without it, `TestBed.createComponent` throws
   `NG0908` for anything that reaches `NgZone` through adf-core
3. `global.ResizeObserver` stub — jsdom does not implement it
4. `TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting())`

Three Vite workarounds baked into every config, each with a real cause:

- `resolve.alias` rewriting `date-fns/locale` — Node's ESM resolver rejects directory imports that
  the Angular bundler tolerates
- `server.deps.inline: [/@alfresco\//, /^date-fns/]` — so the alias actually applies to
  externalised `node_modules`
- `pool: 'threads'` and `forceExit: true` — the default pool crashes under Node 20, and zone.js
  keeps the event loop alive after TestBed teardown

**The trap that has cost this programme a phase, twice:** _`test` does not typecheck._ Vitest
strips types through esbuild. A green `test` run is **not** type safety — only `build` and
`typecheck` catch a TS error, and they run last. That is why separate `typecheck` (via `ngc`) and
`spec-types` gates exist.

- [Vitest](https://vitest.dev/guide/)
- [Angular testing guide](https://angular.dev/guide/testing)
- [Analog Angular Vite plugin](https://analogjs.org/docs/features/testing/vitest)
- [`ng-mocks` (note: **stubbed locally here**, see §18)](https://ng-mocks.sudo.eu/)

Estimated effort: **20 hours**.

---

### 12. End-to-end testing and accessibility — **Should**

Playwright is installed with `npm install --no-save` **on purpose**, so it never appears in
`package.json` and CI installs are not burdened with a ~300 MB browser download. Consequently
`apps/nuxeo-ui-e2e` is not an `@nx/playwright` project and has no `test` target.

Configuration facts worth knowing before you write a spec:

- Projects: `chromium` (Desktop Chrome) and `webkit` (Desktop Safari, the closest verifiable proxy)
- `workers: 1` — serial, because every spec shares one Nuxeo repository
- `retries: CI ? 2 : 1`, `timeout: 45_000`, `expect.timeout: 10_000`, `forbidOnly: true`
- Trace, screenshot and video all `retain-on-failure` / `only-on-failure`
- **Two auth mechanisms, both required**: `httpCredentials` for Basic on every request, _and_ an
  `addInitScript` that writes the app's session into `sessionStorage`. `storageState` does not work
  because the app uses `sessionStorage`, not `localStorage`.

Accessibility: `@axe-core/playwright` (also untracked), scanning 15 cases across 8 routes against
WCAG 2.1 A/AA. Separately, `npm run a11y` runs 11 `@angular-eslint/template` a11y rules over 89
templates and compares against `tools/a11y/baseline.json` — the verdict is "no _new_ violations",
not "zero violations".

- [Playwright](https://playwright.dev/docs/intro)
- [Playwright fixtures](https://playwright.dev/docs/test-fixtures)
- [axe-core Playwright](https://playwright.dev/docs/accessibility-testing)
- [WCAG 2.1 quick reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [Deque axe rule descriptions](https://dequeuniversity.com/rules/axe/4.10)

Estimated effort: **15 hours**.

---

## Part IV — The Nuxeo domain

### 13. Nuxeo Platform — **Must** (the largest domain module)

Server: Nuxeo LTS, targeted at `[2025.0,2026.0)`; the Maven build uses `nuxeo-parent` **11.5.154**.
Runs locally in Docker on port 8080 with OpenSearch.

This is the deepest domain area, and no amount of Angular skill substitutes for it. Roughly
**one third of all defects in this codebase are Nuxeo-semantics defects**, not Angular defects.

#### 13.1 Core concepts

Repository model — documents, **document types** (`File`, `Folder`, `OrderedFolder`, `Note`,
`Workspace`, `WorkspaceRoot`, `Section`, `SectionRoot`, `Domain`, `Collection`, `Favorites`,
`TemplateRoot`, `Picture`, `Video`, `Audio`), **schemas** (`dublincore` → `dc:*`, `file` →
`file:content`, `files` → `files:files`, `uid` → `uid:major_version`, `nxtag` → `nxtag:tags`),
**facets/mixins** (`Folderish` — 155 references and the canonical folder test —
`HiddenInNavigation`, `Versionable`), lifecycle states, versions, proxies, ACLs.

#### 13.2 REST API v1

Base `/nuxeo/api/v1`. Everything goes through `NuxeoApiBase`
(`libs/shared/nuxeo-client/src/lib/services/nuxeo-api-base.ts`).

Endpoints in active use: `/id/{uid}`, `/path/{path}`, `/me`, `/me/changepassword`,
`/search/lang/NXQL/execute`, `/search/pp/{provider}/execute`, `/search/saved`,
`/search/bulk/{action}`, `/user`, `/user/search`, `/group`, `/group/search`, `/token`,
`/oauth2/provider`, `/oauth2/token/client`, `/oauth2/token/provider`, `/workflow`,
`/workflowModel`, `/task`, `/task/{id}/{action}`, `/task/{id}/delegate`, `/task/{id}/reassign`,
`/config/types`, `/config/facets`, `/config/schemas`, `/directory/{name}`, `/upload/new/{handler}`,
`/upload/{batchId}/{index}`, `/bulk/{commandId}`.

**Adapters** (`@`-suffixed) actually used: `@children`, `@blob/file:content`, `@blob/blobholder:0`,
`@blob/{xpath}`, `@rendition/thumbnail`, `@rendition/pdf`, `@audit`, `@comment`, `@export`,
`@task`, `@workflow`, `@tag`, `@subtypes`, `@op/{OperationId}`, `@async`.

**Enrichers and headers**: `enrichers-document: thumbnail, permissions, acls`,
`X-NXRepository: default`, `X-NXfetch.task: targetDocumentIds,actors`,
`fetch.group: memberUsers,memberGroups`, `properties: dublincore`, and the proxy-level
`X-NXproperties: *`. Enricher results land in `contextParameters`.

**Page providers** referenced by name: `default_search`, `assets_search`, `tree_children`,
`nxql_search`, `default_content_collection`, `LATEST_CREATED_USERS_OR_GROUPS_PROVIDER`.

#### 13.3 NXQL

`ecm:parentId`, `ecm:path`, `ecm:primaryType`, `ecm:mixinType`, `ecm:isTrashed`, `ecm:isVersion`,
`ecm:currentLifeCycleState`, `ecm:fulltext`, `DATE` literals, `STARTSWITH`, `IN`, `LIKE`,
`ORDER BY`. Literal escaping is centralised in `escapeNxqlLiteral` — **never** build a query by
string concatenation.

**Four measured facts about search behaviour that will bite you.** These are recorded as verified
findings in `AGENTS/11-beta-program.md` §3; do not re-litigate them, and do not design around the
assumption that they are false:

1. **NXQL search is OpenSearch-backed and lags.** Immediately after two `Document.CheckIn` calls, a
   version query returned one of two rows. Anything that must reflect a write you just made must
   not go through the search endpoint.
2. **An unsupported `sortBy` returns HTTP 200 with zero entries**, not an error. Sort keys must be
   validated client-side before the request goes out.
3. **`resultsCount` is a real total only when the result set fits on one page**; otherwise it is
   `-2`. This is why the pager is next/previous rather than numbered.
4. **"Folders first" is not expressible as a Nuxeo sort** — there is no sortable folderish property.

#### 13.4 Automation operations

Two call styles: `POST /automation/{Op}` with `{params, context, input}`, and the document-scoped
`POST /id/{uid}/@op/{Op}`.

- **Lifecycle:** `Document.Lock`, `Document.Unlock`, `Document.Trash`, `Document.Untrash`,
  `Document.Subscribe`, `Document.Unsubscribe`, `Document.AddToFavorites`,
  `Document.RemoveFromFavorites`, `Document.AddToCollection`, `Document.PublishToSection`,
  `Document.CheckIn`, `Document.CreateVersion`, `Document.GetVersions`, `Document.RestoreVersion`,
  `Document.Copy`, `Document.Move`
- **Permissions:** `Document.AddPermission`, `Document.ReplacePermission`, `Document.AddACE`,
  `Document.SetACE`, `Document.RemoveACE`, `Document.RemoveACL`, `Document.RemovePermission`,
  `Document.BlockPermissionInheritance`, `Document.UnblockPermissionInheritance`,
  `Document.SendNotificationEmailForPermission`
- **Tags:** `Services.TagDocument`, `Services.UntagDocument`
- **Search / audit / directory:** `Repository.Query`, `Audit.QueryWithPageProvider`,
  `Search.SuggestersLauncher`, `Directory.SuggestEntries`
- **Users / collections:** `User.GetUserWorkspace`, `User.GetCollections`, `User.Invite`,
  `UserGroup.Suggestion`, `Collection.Create`
- **Blobs / bulk:** `Blob.AttachOnDocument`, `Blob.BulkDownload`, `Bulk.RunAction`
  (`csvExport`, `ingest`), `CSV.Import`
- **Drive:** `NuxeoDrive.GetRoots`, `NuxeoDrive.SetSynchronization`
- **Hyland connector:** `HylandIngest.CheckDigest`, `HylandKnowledgeDiscovery.*`,
  `HylandKnowledgeEnrichment.*`

**A distribution-specific fact:** the `@versions` adapter is **not registered** on this Nuxeo
distribution — it answers `404 Service versions not found for object`. The code uses the
`Document.GetVersions` operation instead, which returns **oldest-first** and reads the repository
directly rather than the search index.

Another: `/config/types` alone returns a _flat_ schema map covering only 48 of 98 schemas on the
local instance. `/config/facets` is the only way to learn what a facet contributes, and
`/config/schemas` is the nested superset. All three reads are needed.

#### 13.5 Subsystems

**Batch upload** — `POST /upload/new/{handler}` → per-file `POST /upload/{batchId}/{index}`
(multipart) → `Blob.AttachOnDocument`. **Permissions and ACLs** — `Read`, `Write`, `ReadWrite`,
`Everything`, `Remove`, `AddChildren`, `ReadCanCollect`, `WriteSecurity`, `WriteProperties`,
`ReadVersion`, `WriteVersion`; inheritance blocking; the pure predicates live in
`libs/shared/nuxeo-client/src/lib/utils/document-permissions.ts`. **Workflows and tasks** — models,
instances, graphs, delegation, reassignment. **Trash** — `ecm:isTrashed` plus trash/untrash
operations and permanent `DELETE`. **Audit** — the `@audit` adapter and
`Audit.QueryWithPageProvider`, backed by a _separate_ OpenSearch index (`nuxeo-audit`).
**Directories/vocabularies** — including l10n entries; the `nature` vocabulary is load-bearing for
Knowledge Enrichment write-back. **Collections and Favorites**. **Comments** — the `@comment`
adapter. **Nuxeo Drive** — `nxdrive://edit` and `nxdrive://direct-transfer` custom-scheme URLs.

- [Nuxeo documentation portal](https://doc.nuxeo.com/)
- [REST API](https://doc.nuxeo.com/rest-api/1/rest-api/)
- [NXQL reference](https://doc.nuxeo.com/nxdoc/nxql/)
- [Automation operations explorer (browse every operation and its parameters)](https://explorer.nuxeo.com/nuxeo/site/distribution/)
- [Content repository concepts](https://doc.nuxeo.com/nxdoc/repository-concepts/)
- [Page providers](https://doc.nuxeo.com/nxdoc/page-providers/)
- [Batch upload](https://doc.nuxeo.com/rest-api/1/blob-upload-for-batch-processing/)
- [Nuxeo Drive](https://doc.nuxeo.com/client-apps/nuxeo-drive/)
- **In-repo, and more accurate than any of the above for this app:** `AGENTS/02-nuxeo-apis.md`,
  `docs/api-integrations.md` (1,523 lines, 27 numbered integrations)

Estimated effort: **50 hours**.

---

### 14. Authentication, session and web security — **Must**

**There is no OIDC and no JWT in this application.** `angular-oauth2-oidc@19.0.0` is a declared
dependency and is imported nowhere in `apps/` or `libs/`; it is deliberately retained because it
causes no harm today. Do not learn OIDC for this codebase, and do not assume it is in play when
debugging.

Three real authentication modes, unified in `apps/nuxeo-ui/src/app/auth/auth.service.ts`:

1. **Basic** — `btoa(user:pass)` validated against `GET /nuxeo/api/v1/me`, persisted under
   `agentic_ui_nuxeo_session`
2. **Cookie / SAML SSO** — full-page navigation to a Nuxeo SAML endpoint configured by
   `NUXEO_SAML_LOGIN_ENDPOINTS`, `NUXEO_SSO_POST_LOGIN_PATH`, `NUXEO_SSO_RETURN_QUERY_PARAM`;
   session presence detected by probing `/me`
3. **Nuxeo `TOKEN_AUTH`** — Instant Share links carry a token read from the URL, immediately
   stripped from the address bar, then sent in the `AUTH_TOKEN_HEADER` **only** — never as a query
   parameter, because query strings leak into proxy and server logs

The interceptor logic is subtle enough to study line by line:

- It only touches URLs whose pathname starts with `/nuxeo/`, and for absolute URLs only on an
  allow-listed origin
- **`withCredentials` is conditional**: logout and the explicit "establish browser session" context
  force cookies **on**; Basic-auth requests force them **off**, because a stale `JSESSIONID` would
  otherwise override the Basic principal
- After a Basic login the app deliberately establishes a same-origin Nuxeo browser session so that
  embedded `<img src="/nuxeo/nxfile/...">` inside Notes loads without headers

Session management: `SessionTimeoutService` does idle tracking with a warning dialog, and
`expireDueToServer()` fires on any 401.

**A local-environment trap:** the local Nuxeo returns HTTP 200 `{id: 'Anonymous'}` for an
unauthenticated `/me`, so the app signs the visitor in as Anonymous and "unauthenticated user is
redirected" is **untestable locally**. Test the _privilege_ boundary, not the sign-in boundary.

Security rules that are PR blockers in this repository (`AGENTS/07-security.md`):

- Never `innerHTML` / `outerHTML` with user content; never `DomSanitizer.bypassSecurityTrust*`
  unless the source is server-controlled — and every such call must be registered in
  `.ai/state/sanitizer-allowlist.json`, which the `beta:sanitizers` gate audits
- Never add `Authorization` headers manually in a component — that is the interceptor's job
- Never call a Nuxeo URL with `fetch()` — use `NuxeoApiBase`
- Never bind `<img [src]>` directly to a Nuxeo URL — fetch via a service, use a blob URL, revoke it
- Credentials from environment only; never hardcoded, never in a query string
- **Hiding an action in a manifest is not a security control** — Nuxeo evaluates permissions
  server-side on every operation

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [Angular security guide](https://angular.dev/best-practices/security)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [SAML 2.0 overview](https://developer.okta.com/docs/concepts/saml/)

Estimated effort: **20 hours**.

---

## Part V — The product's own architecture

### 15. The four-layer extensibility contract — **Must**

This is the product. Everything else is implementation. Read
[Extensibility Contract](07-extensibility-contract.md) and `docs/extension-reference.md` (884
lines) in full.

| Layer                      | Surface                                                                     | Customer writes      | Rebuild?           |
| -------------------------- | --------------------------------------------------------------------------- | -------------------- | ------------------ |
| **0 — Configuration**      | Theme tokens, nav items, action visibility, presets, labels                 | JSON + CSS variables | No                 |
| **1 — Declarative wiring** | Manifest references components, rules, actions, routes **by registered ID** | JSON                 | No                 |
| **2 — Customer code**      | New components, actions, rules, guards in their own library                 | TypeScript           | Yes, in their repo |
| **3 — Agent harness**      | Knowledge base, Nx generators, runnable guardrails                          | Prompts              | Yes, in their repo |

**Two configuration stores that are constantly confused. They are not the same thing.**

- **Bootstrap** — `/nuxeo/agentic-ui-config/bootstrap.json`, read **pre-authentication**.
  Holds `nuxeoApiOrigin`, `nuxeoServerUrl`, `aiBackendUrl`, `branding`,
  `themes`/`defaultThemeId`, `defaultLanguage`, `integrations` (ARender, KD and KE operation maps),
  `session` (idle timeout), `sso`.
- **Runtime manifest** — `/nuxeo/agentic-ui-config/manifest.json`, also read
  **pre-authentication**, in parallel with the bootstrap. Holds `version`, `navItems`, `actions`, `rules`,
  `presets`, `featureToggles`, `labels`, `extensions`. It has **no `integrations` key** — ARender
  configured there silently does nothing.

Both are the configuration servlet's envelope of ordered fragments, one per Marketplace package;
the browser applies them in order over its compiled defaults. Both loads are deliberately
tolerant: a 404, an unreachable server or a response that is not the envelope falls back to
packaged defaults. The manifest Note this used to be (`/default-domain/config/agentic-ui`) is no
longer read, with no migration.

**Registered IDs** follow `<owner>.<surface>.<name>`. Renaming a shipped ID is a **breaking
change**. Eight slots: `navbar` (14 packaged entries), `bulk-actions` (6), `toolbar` (16–17),
`tabs` (6), `contextMenu` (4), `documentList` (12 columns, 9 hidden by default), `sidebar` and
`routes` (both resolve, no packaged entries).

**Rule semantics you must know cold, because getting them wrong is a security bug:**

- **An unregistered rule ID evaluates to `true`** (fails open), so a typo cannot strip working
  actions from every user. The exception is `SECURITY_RELEVANT_RULE_IDS` — the three user rules —
  which fail **closed**.
- **`core.not` is NOR, not NAND** (`args.every(arg => !evaluator(...))`). A prior NAND
  implementation agreed for one argument and diverged from two upwards.
- **A manifest cannot rebind a packaged action.** An `action` supplied on a packaged ID is ignored,
  because a star labelled "Add to Favorites" that deletes the document would otherwise genuinely
  work.
- `overrides` honours exactly four keys — `order`, `label`, `rule`, `visible`. Anything else is
  silently dropped; `hiddenByDefault` must go through `slots`.

`$references` layering uses our own copy of ACA's `mergeObjects`, pinned to the output of
`@alfresco/adf-extensions` 9.0.0 (Alfresco Content App semantics): later wins, `$`-prefixed keys do not merge, arrays of objects merge **by
`id`**, `"<key>.$replace"` replaces, `$ignoreReferenceList` drops a layer.

- **In-repo:** `docs/extension-reference.md`, `libs/platform/extension-reference.md`,
  `AGENTS/11-beta-program.md`, `libs/extensions/acme-extensions/` (the worked customer example)
- [ADF extensibility (the upstream model this borrows from)](https://alfresco-content-app.netlify.app/#/extending/)
- [`@alfresco/adf-extensions` source](https://github.com/Alfresco/alfresco-ng2-components/tree/develop/lib/extensions)

Estimated effort: **20 hours**.

---

### 16. adf-hx, ADF and the Hyland Experience stack — **Area** (but Must for browse/search work)

_Changed by NXSAT-635 and NXSAT-638 (2026-10):_ none of this module is in the product any more. The
bridge library, its ports and the POC routes were removed on 2026-10-14 (NXSAT-635), and the
packages below by NXSAT-637. §16.1 to §16.4 are kept as the record; skip them unless
you are reading history. Browse and search now use the `nxs-` components in
`libs/shared/satori-components`.

| Package                             | Version              | Registry             | Note                                                        |
| ----------------------------------- | -------------------- | -------------------- | ----------------------------------------------------------- |
| `@alfresco/adf-hx-content-services` | 7.20.0-automate.292  | GitHub Packages only | **Removed in NXSAT-637**                                    |
| `@alfresco/adf-core`                | 9.0.0                | GitHub Packages      | **Removed in NXSAT-637**                                    |
| `@alfresco/adf-extensions`          | 9.0.0                | public npm           | **Removed in NXSAT-637**                                    |
| `@alfresco/js-api`                  | 10.0.0               | devDependency        | **Removed in NXSAT-637**                                    |
| `@hylandsoftware/hxcs-js-client`    | 2.0.111              | GitHub Packages      | **Removed in NXSAT-637**                                    |
| `@hylandsoftware/satori-ui`         | **0.2.1** (`^0.2.1`) | GitHub Packages      | Hyland design system; deliberately absent from the template |

Authentication for installs is `SATORI_GH_READONLY_TOKEN` with `read:packages` on the Hyland org.
`.npmrc` maps `@hylandsoftware` to `https://npm.pkg.github.com`; the `@alfresco` mapping went with
the last `@alfresco` package in NXSAT-637.

Context that explains a lot of the workarounds: there has been no stable adf-hx release in twelve
months (last true stable `7.19.5`, on an Angular 15 baseline); the published packages are compiled
against **Angular 19.2.18** while this repo runs 20.3.33; and the dependency contract is
**under-declared** — one declared peer against thirteen imported packages — so the pin set is
maintained by hand.

#### 16.1 The twelve API ports

adf-hx exposes twelve overridable injection tokens, all bound in
`libs/shared/adf-hx-bridge/src/lib/providers/provide-adf-hx-nuxeo-bridge.ts`:

`DOCUMENT_API_TOKEN`, `QUERY_API_TOKEN`, `VERSION_API_TOKEN`, `COPY_API_TOKEN`, `MOVE_API_TOKEN`,
`CHECKIN_API_TOKEN`, `DOWNLOAD_API_TOKEN`, `USER_API_TOKEN`, `GROUP_API_TOKEN`,
`RENDITIONS_API_TOKEN`, `UPLOAD_API_TOKEN`, `MODEL_API_TOKEN`, plus `IDENTITY_USER_SERVICE_TOKEN`.

`UPLOAD` is bound to an implementation that **refuses every call**, because Nuxeo's batch upload is
a different protocol rather than a different endpoint. Bound-but-refusing is deliberate: eleven
upstream services inject their token at construction, so an _unbound_ token stops components
constructing at all, whereas a refusing one constructs and then fails at the point of use with a
message naming the operation.

#### 16.2 The HxPR document model — mapping gotchas

Every one of these cost real debugging time and none is documented upstream:

- **Nuxeo has no `sys` schema**, so the MODEL mapper supplies a pseudo-schema describing what our
  own mapper emits. Without it, `Created` renders as a raw ISO string and `Creator` as
  `[object Object]`.
- **HxPR keys schema fields by their _prefixed_ name** (`dc_title`) while sub-fields stay
  unprefixed. Get it wrong and every field silently becomes `FieldType.String`.
- **A Nuxeo `@prefix` of `''` means "use the schema name"** — `file`, `uid` and `files` all report
  empty and are addressed as `file:content`, `uid:major_version`.
- **`sys_primaryType` must carry the real Nuxeo doctype name**, because it is the key into
  `Model.primaryTypes`. Classify with `sys_isFolderish` and `sys_mixinTypes`, never
  `sys_primaryType`.
- **adf-hx writes `SysFilish`, with no `e`.**
- **Nuxeo sends no `versionLabel`** — build it from `uid:major_version` / `uid:minor_version`. A
  version's `parentRef` is the live document's _folder_; the live document id is `versionableId`.
- **Never hand upstream a `User` with an unset `firstName`** — `getFullName` is an unguarded
  template literal that renders `undefined undefined`.

#### 16.3 The `hxp-*` prefix lies

The prefix tells you nothing about authorship; the **import** does. Genuinely upstream:
`hxp-document-list`, `hxp-breadcrumb`, `hxp-properties-sidebar`, `hxp-ui-document-viewer`,
`hxp-manage-versions-sidebar`, `hxp-document-tree`, `PermissionsManagementPanelComponent`.
Everything else under `libs/shared/adf-hx-bridge/src/lib/ui/` — thirteen components — is ours.

#### 16.4 The two-entry-point split

`adf-hx-bridge` exports from two barrels on purpose. A barrel is one module, so re-exporting the
ports from the main barrel dragged adf-core into the _initial_ bundle: measured 1.70 MB baseline →
2.65 MB with ports → 2.86 MB with the document-list swap, against a 2.00 MB `maximumError` at the
time. Anything importing `@alfresco/adf-hx-*` is exported only from
`@agentic-ui/shared/adf-hx-bridge/providers`. The lazy POC route is the intended consumer for
most of that surface; `app.config.ts` and the shell nav drawer also import it on purpose for
`provideAdfHxNuxeoBridge()` and `HxpBrowseNavDrawerComponent` (documented in
`providers.ts` and the guardrail allowlist in `scripts/review-guardrails.mjs`).

- [ADF documentation](https://alfresco-ng2-components.netlify.app/)
- [ADF source](https://github.com/Alfresco/alfresco-ng2-components)
- **In-repo, and the only accurate source for the bridge:** `libs/shared/adf-hx-bridge/ARCHITECTURE.md`
  (removed with the bridge; in git history),
  `docs/adf-hx-upstream-findings.md`, `docs/adf-hx-workarounds.md`, `docs/adf-hx-beta-plan.md`

Estimated effort: **30 hours**.

---

### 17. AI features and the Hyland AI stack — **Area**

#### 17.1 `AI.*` automation operations

**The AI backend is not in this repository.** It is a Java Nuxeo marketplace package that calls the
**Hyland AI Platform (HAIP) Model Gateway**, an OpenAI-compatible API, with credentials held
server-side. If the package is absent from the target server every AI call returns **HTTP 500 —
expected, not a client defect.**

Twelve operations, verified in `libs/shared/ai-client/src/lib/ai-gateway.service.ts`:

| Operation           | Parameters                                |
| ------------------- | ----------------------------------------- |
| `AI.NlToNxql`       | `query`, `suggestions`                    |
| `AI.Summarize`      | `docId`                                   |
| `AI.SuggestTags`    | `docId`                                   |
| `AI.Classify`       | `docId`                                   |
| `AI.Similar`        | `docId`, `limit`                          |
| `AI.Chat`           | `message`, `historyJson`, `docId`, `page` |
| `AI.Sentiment`      | `commentsJson`                            |
| `AI.Insights`       | `userId`                                  |
| `AI.Anomalies`      | `timeRange`                               |
| `AI.NlPermissions`  | `query`                                   |
| `AI.AuditNlFilter`  | `query`, `today`                          |
| `AI.AuditSummarize` | `entriesJson`                             |

Note the JSON-stringified-parameter convention (`historyJson`, `commentsJson`, `entriesJson`) — a
consequence of Automation's flat parameter model.

RAG happens **server-side**. There is no client-side streaming: no `EventSource`, no chunked reads.
Each chat turn is a single POST with the history replayed.

Feature flag: `AiFeatureFlagService` is a signal backed by `localStorage['ai-features-enabled']`,
**default on** with an explicit user opt-out, surfaced to the manifest as rule
`app.rules.isAiEnabled`, which gates the `app.tabs.aiInsights` tab.

Concepts to learn: prompt/response contracts, RAG at a conceptual level, why a UI must treat every
AI response as untrusted content (the `AiMarkdownPipe` renders through DOMPurify), and graceful
degradation when the backend is absent.

- **In-repo:** `docs/ai-features.md` (429 lines), `AGENTS/10-ai-features.md`
  (_note: this file is stale — it documents an `ai.service.ts` façade that does not exist_)
- [OpenAI API reference (HAIP is OpenAI-compatible)](https://platform.openai.com/docs/api-reference)
- [RAG primer](https://www.pinecone.io/learn/retrieval-augmented-generation/)

#### 17.2 Knowledge Discovery, Knowledge Enrichment, Content Lake

Two server-side plugins, two configuration namespaces, two service accounts:

| Plugin                                                    | Role                                                                   | `nuxeo.conf` namespace |
| --------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------- |
| `nuxeo-labs-content-intelligence-connector` (CIC, 2025.x) | Exposes `HylandKnowledgeDiscovery.*` and `HylandKnowledgeEnrichment.*` | `nuxeo.hyland.cic.*`   |
| `nuxeo-hxai-connector` (2025.1.0)                         | Ships binaries and metadata into HxAI Ingestion → Content Lake         | `hxai.*`               |

External systems and their vocabulary: **HX IDP / Nucleus** (OAuth 2.0 client-credentials at
`auth.iam.<env>.experience.hyland.com/idp`), **Discovery** (`discovery.<env>.experience.hyland.com`
hosting _two_ services — the Agent API under `/agent/*` and the QnA API under `/qna/*`),
**Ingestion** (`ingestion.insight.<env>.experience.hyland.com`), **Content Lake**, and the
**Hyland Insight admin UI** where agents are created (agent CRUD is deliberately unavailable in
this app).

Transport quirk worth memorising: KD operations post to `/nuxeo/site/automation/{OpName}` — note
`/site/`, **not** `/api/v1/`. Every CIC operation returns the envelope
`{response, responseCode, responseMessage}`, which `KdClientService` unwraps. Read-only metadata
goes through a generic `Invoke` passthrough that supports **GET, POST and PUT only** — `DELETE` is
rejected outright.

Knowledge Enrichment actions and their Nuxeo write-back:

| KE action                                             | Written to                        |
| ----------------------------------------------------- | --------------------------------- |
| `text-classification`                                 | `dc:nature`                       |
| `named-entity-recognition-text`                       | `nxtag:tags`                      |
| `text-summarization`                                  | `dc:description`                  |
| `image-description`, `named-entity-recognition-image` | `dc:description` and `nxtag:tags` |

Two LLM outputs are rejected before any write — the sentinel `not_from_provided_classes`, and any
value absent from the Nuxeo `nature` vocabulary — because Nuxeo answers an invalid `dc:nature` with
**HTTP 422** and the UI would silently desynchronise.

**Two configuration traps.** The connector's compiled defaults for `hxai.nucleus.auth.base.url`,
`hxai.nucleus.system.integration.base.url` and `hxai.ingest.base.url` point at **production**, and
`nuxeo.conf` entries are **not honoured at runtime** — a `ConfigurationService` XML contribution on
the classpath is required. And the token scope must be `hxp iam.jti-capture` for the newer
`sc-*` / `hyx_cs_*` service accounts; the connector's baked-in default is rejected as
`invalid_scope`.

- **In-repo:** `docs/knowledge-discovery.md` (372 lines), `docs/knowledge-enrichment.md` (294),
  `docs/api-integrations.md` §24–26, `nuxeo-conf/README.md`,
  `.cursor/skills/kd-local-setup/SKILL.md`
- [OAuth 2.0 client credentials grant](https://datatracker.ietf.org/doc/html/rfc6749#section-4.4)

Estimated effort: **20 hours** for §17.1 and §17.2 together.

---

### 18. Third-party UI and utility libraries — **Area**

| Library                         | Version                     | Where                                         | What to learn                                                                                                                                                                                                                                                     |
| ------------------------------- | --------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quill**                       | **2.0.3** (`^2.0.3`)        | `document-detail/note-editor` — 44 references | Delta model, toolbar modules, custom handlers, image insertion                                                                                                                                                                                                    |
| **DOMPurify**                   | **3.4.16** (`^3.4.16`)      | Notes, comments, AI markdown, `nuxeo-client`  | Configuration, hooks, and _why_ sanitising on output is not enough                                                                                                                                                                                                |
| **`@ngx-translate/core`**       | **17.0.0**                  | App and three features                        | Custom `TranslateLoader`. **Trap:** adf-core's `TranslationService` does _not_ use the ngx-translate loader interface — extend `AppTranslateLoader` and override `getTranslation`; swapping in adf-core's loader deletes the manifest-`labels` Layer 0 capability |
| **`@hylandsoftware/satori-ui`** | **0.2.1**                   | `nuxeo-ui` only                               | `SatAvatar`, `SatBreadcrumbs`, `SatTag`, `sat.theme()`                                                                                                                                                                                                            |
| **`pdfjs-dist`**                | **6.2.108**                 | —                                             | A version pin left over from the adf-core peer set. Nothing depends on it since NXSAT-637 removed adf-core; NXSAT-672 drops it.                                                                                                                                   |
| **`cropperjs`**                 | **1.6.2**                   | `angular.json` styles only                    | Left over from adf-core's image viewer. Nothing depends on it since NXSAT-637; NXSAT-672 drops it.                                                                                                                                                                |
| **`date-fns`**                  | **2.30.0**                  | The Material adapter's peer only              | A version pin left over from adf-core; NXSAT-672 drops it with the adapter.                                                                                                                                                                                       |
| **`minimatch`**                 | **10.2.6**                  | Tooling                                       | Glob matching                                                                                                                                                                                                                                                     |
| **`ng-mocks`**                  | `file:tools/stubs/ng-mocks` | —                                             | **Not a test-tooling choice.** It is a local stub that replaced the real package, because adf-hx imported `ng-mocks` from its _shipped runtime_ bundle, putting a test library and two `eval()` calls into a 1.6 MB customer chunk. Stays until NXSAT-672.        |
| **`angular-oauth2-oidc`**       | **19.0.0**                  | Nowhere                                       | Declared, unused, deliberately retained                                                                                                                                                                                                                           |

- [Quill](https://quilljs.com/docs/quickstart)
- [DOMPurify](https://github.com/cure53/DOMPurify)
- [ngx-translate](https://github.com/ngx-translate/core)
- [PDF.js](https://mozilla.github.io/pdf.js/)
- [Cropper.js](https://fengyuanchen.github.io/cropperjs/)
- [date-fns v2](https://date-fns.org/v2.30.0/docs/Getting-Started)

Estimated effort: **12 hours**.

---

## Part VI — Packaging, delivery and operations

### 19. Publishing the platform package — **Area**

`libs/platform` is the only publishable library, built with `@nx/angular:package` (ng-packagr
**20.3.2** underneath), published as `@nuxeo-satori/platform@0.2.0`.

Topics: ng-packagr, the Angular Package Format, **secondary entry points** (five `ng-package.json`
files: root plus `app-config`, `extensions`, `nuxeo-client`, `ui`), `sideEffects: false`,
`peerDependencies` (ten declared), semantic versioning, and API-surface review.

Three hard-won facts:

- **`compilationMode: partial` is required.** Phase 4 shipped a package that could not be published
  at all without it.
- **`ng-packagr-lite` was tried and rejected** — it skips FESM bundling and produced four
  unresolvable subpaths.
- ng-packagr **refuses assets outside the package root**, which is why
  `scripts/sync-platform-docs.mjs` copies the customer docs in as a build pre-step.

Why one package with four entry points rather than four packages: four packages means four version
bumps and four compatibility matrices for every customer upgrade.

- [ng-packagr](https://github.com/ng-packagr/ng-packagr)
- [Angular Package Format](https://angular.dev/tools/libraries/angular-package-format)
- [Creating libraries](https://angular.dev/tools/libraries/creating-libraries)
- [Semantic Versioning](https://semver.org/)

Estimated effort: **10 hours**.

---

### 20. Java, Maven, OSGi and Nuxeo Marketplace packaging — **Area**

The shipped deliverable is a **Nuxeo marketplace package**, not a static bundle. If you never touch
release engineering you can skip this; if you do, it is unavoidable.

| Item            | Version                                                       |
| --------------- | ------------------------------------------------------------- |
| Java            | **21** (`maven.compiler.source/target`)                       |
| Maven           | 3.9+                                                          |
| `nuxeo-parent`  | **11.5.154**                                                  |
| Reactor version | `org.nuxeo.agentic:nuxeo-agentic-ui-parent:2026.0.2-SNAPSHOT` |
| Target platform | `lts [2025.0,2026.0)`                                         |

Three modules: `apps/nuxeo-ui` (packaging `pom`, drives the Angular build through
`frontend-maven-plugin` 1.15.0), `nuxeo-agentic-core` (a **real OSGi bundle** with a `MANIFEST.MF`
and four `OSGI-INF/*.xml` contributions, including a URL codec and auth configuration), and
`nuxeo-agentic-ui-package` (assembles the marketplace ZIP via `maven-assembly-plugin`).

**`install.xml` is the single most consequential packaging file**, and the reason is upgrade
safety:

```
<update file="${package.root}/install/bundles" todir="${env.bundles}" />
<copy dir="${package.root}/web" todir="${env.server.home}/nxserver" overwrite="true" />
```

The `overwrite="true"` copy destroys everything under `nuxeo.war/agentic-ui/` on every upgrade —
which is one reason customer configuration is never a file on the server. Since NXSAT-312 it is
contributed by the customer's own Marketplace package to the configuration service in
`nuxeo-agentic-core` and served by a servlet at `/nuxeo/agentic-ui-config/`; the package installs no
configuration file. An `overwrite="false"` copy that protected an edited file made the upgrade fail,
leaving no version installed (NXSAT-317), and `checkInstallerOwnsNoCustomerFile` rejects it, along
with any copy into `agentic-ui-config`. The destination **must** be under `nxserver/nuxeo.war`, the
Tomcat docBase for `/nuxeo`; `nxserver/web` is not a docBase, and a build that shipped that variant
would have 404'd in every deployment.

- [Maven](https://maven.apache.org/guides/index.html)
- [Nuxeo package definition](https://doc.nuxeo.com/nxdoc/creating-nuxeo-packages/)
- [Nuxeo component model and extension points](https://doc.nuxeo.com/nxdoc/nuxeo-runtime/)
- [OSGi core concepts](https://www.osgi.org/resources/where-to-start/)
- **In-repo:** `NUXEO_MARKETPLACE_GUIDE.md` (27 kB), `docs/publishing-to-nuxeo-registry.md`

Estimated effort: **20 hours**.

---

### 21. Local infrastructure — Docker, ARender, OpenSearch, Mailpit — **Should**

| Service                | Image / version                       | Port                                                            | Purpose                                                      |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| Nuxeo                  | container `nuxeo`                     | 8080                                                            | The backend                                                  |
| OpenSearch             | `opensearchproject/opensearch:2.17.1` | 9200 / 9600                                                     | Search and audit indices                                     |
| Mailpit                | `axllent/mailpit:v1.22.3`             | 8025 web / 1025 SMTP                                            | Local SMTP sink for invites and permission notifications     |
| ARender (6 containers) | `${ARENDER_VERSION}` = **2023.19.0**  | 9080 UI, 8761 broker, 9091 renderer, 8899 text, 19999 converter | Licensed document viewer and annotations                     |
| nginx auth sidecar     | `nginx:alpine`                        | —                                                               | Injects `Authorization: Basic` on ARender→Nuxeo blob fetches |

Topics: Docker Compose (networks — everything joins `nuxeo-net` — volumes, `extra_hosts`,
`envsubst` templating), nginx as a reverse proxy and auth sidecar, and Nuxeo `conf.d` fragment
configuration (only `*.sample.conf` is committed; real `*.conf` files are gitignored).

OpenSearch specifics: two indices, `nuxeo` (documents, full-text, aggregations) and `nuxeo-audit`.
Configuration keys `opensearch.addressList`, `opensearch.indexName`, `audit.opensearch.indexName`,
`opensearch.reindex.onStartup`. Nuxeo translates page providers and `ecm:fulltext` into OpenSearch
DSL and returns aggregation buckets as facets. **This is the source of the index-lag and
`resultsCount` behaviour in §13.3** — the two topics are the same topic.

ARender specifics: `ARENDER_CONFIG` defaults to `null`, so **ARender is off unless configured**. The
compiled-in `localhost:9080` defaults were removed as a Sonar `S5332` finding — a shipped build
pointed the viewer at the _user's own_ machine over plaintext. Configure
`integrations.arender.viewerOrigin` in a **bootstrap fragment** of the configuration package, never
the runtime manifest. Leave out `.nuxeoInternalUrl`: nothing uses it, and bootstrap is served before
authentication, so it would publish an internal host name. Annotations require a `file:content`
blob, so Notes never show the viewer.

- [Docker Compose](https://docs.docker.com/compose/)
- [OpenSearch documentation](https://opensearch.org/docs/latest/)
- [Nuxeo OpenSearch/Elasticsearch setup](https://doc.nuxeo.com/nxdoc/elasticsearch-setup/)
- [nginx reverse proxy](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/)
- [Mailpit](https://mailpit.axllent.org/docs/)
- **In-repo:** `docs/arender-setup.md`, `docs/opensearch-setup.md`, `nuxeo-conf/README.md`

Estimated effort: **15 hours**.

---

### 22. CI/CD, quality gates and security scanning — **Should**

#### 22.1 GitHub Actions — eleven workflows

| Workflow                | Trigger                                            | Role                                                                                                                                                     |
| ----------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | PR to `main`; push to `main`/`feature/**`/`fix/**` | The main gate: guardrails → static beta gates → affected lint/build/test/typecheck → published-package checks → bundle-size ceiling (6 MiB total JS+CSS) |
| `sonarcloud.yml`        | PR, push, dispatch                                 | Coverage merge, scan, quality gate, PR comment                                                                                                           |
| `a11y.yml`              | PR, push, `workflow_call`, dispatch                | Template a11y rules against a baseline                                                                                                                   |
| `build-marketplace.yml` | PR (build only), dispatch (can publish)            | JDK 21 + Node 20, Maven package, publish to pre-prod                                                                                                     |
| `release.yml`           | dispatch only                                      | `npm version`, changelog, tag, GitHub release, then dispatches the marketplace build                                                                     |
| `changelog.yml`         | push to `main`, dispatch                           | Regenerates `CHANGELOG.md` from Conventional Commits                                                                                                     |
| `dependency-review.yml` | PR                                                 | Fails on moderate-severity advisories                                                                                                                    |
| `pr-auto-fix.yml`       | review submitted                                   | Summarises genuinely-open review threads via GraphQL                                                                                                     |
| `dead-code.yml`         | weekly                                             | `knip`, opens an issue                                                                                                                                   |
| `staleness-check.yml`   | weekly                                             | Diffs the service files against `AGENTS/01-services.md`                                                                                                  |
| `stale.yml`             | daily                                              | Closes stale PRs                                                                                                                                         |

CodeQL runs through GitHub's **default setup** (repository settings), not a workflow, with the
`security-extended` suite over `apps` and `libs`.

#### 22.2 The local gate — twenty-six checks, not six

`npm run beta:gate` runs, cheapest first, stopping at the first failure:

`node` → `lockfile` → `lockfile-selftest` → `dependency-tree` → `dependency-tree-selftest` →
`supply-chain` → `code-scanning` → `guardrails` → `guardrails-selftest` → `crowdin-selftest` →
`sanitizer-audit` → `sanitizer-selftest` → `assertions` → `lint` → `test` → `build` → `typecheck`
→ `spec-types` → `bundle` → `api-surface` → `publishability` → `fork-simulation` →
`upgrade-rehearsal` → `reference-drift` → `agent-mirror` → `customer-guardrails`

Each exists because of a specific failure that got through. The ones worth understanding in detail:
`publishability` runs a real `npm publish --dry-run` and is the only thing that executes
`prepublishOnly`; `fork-simulation` compiles the customer template against the _built_ declarations
rather than the source tree; `upgrade-rehearsal` installs, customises across Layers 0/1/2, upgrades,
and proves the customisation survived; `coverage-gate` is a **ratchet** that fails on regression
rather than a fixed 90% cliff.

#### 22.3 SonarCloud

Organisation `nuxeo`, project key `nuxeo_agentic-ui-poc`. Coverage is **one explicit path** —
`coverage/lcov.info`, written by `scripts/lcov-merge.mjs`, which rebases every project's LCOV onto
the repository root and fails if any source path does not resolve. Sonar drops unresolvable paths
silently and reports 0%, which is exactly what happened before the merge script existed.

- [GitHub Actions](https://docs.github.com/en/actions)
- [Actions security hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [SonarQube Cloud](https://docs.sonarsource.com/sonarqube-cloud/)
- [CodeQL](https://codeql.github.com/docs/)
- [Dependabot](https://docs.github.com/en/code-security/dependabot)
- [knip (dead code)](https://knip.dev/)
- **In-repo:** [Dev Harness & Gates](08-dev-harness-and-gates.md), `docs/security-scanning.md`,
  `docs/sonarcloud-setup.md`

**The governing principle, and the most transferable thing in this entire document:**
_a gate is not evidence until you have seen it fail on purpose._ Three gates in this programme were
green while the thing they guarded was broken — an evidence check comparing script `src` attributes
instead of bundle bytes, a path check that was tautological under the dev base href, and a lockfile
gate that matched dependency names but not versions. Break it deliberately, watch it go red, then
trust it.

Estimated effort: **15 hours**.

---

## Part VII — Feature coverage map

Every user-facing feature in the repository, and what you need to know to build or change it. This
is the "do not miss a single feature" checklist.

### Application shell and cross-cutting

| Feature                                                                  | Location                                              | Technologies beyond Angular core                      |
| ------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------- |
| Login page (Basic + SSO)                                                 | `apps/nuxeo-ui/src/app/login/`                        | §14 auth, Nuxeo `/me`, SAML redirect                  |
| App shell, navbar, sidebar                                               | `apps/nuxeo-ui/src/app/shell/`                        | §15 extension slots, Satori UI                        |
| Dashboard with AI insight cards                                          | `apps/nuxeo-ui/src/app/dashboard/`                    | §17.1 `AI.Insights`, widget grid                      |
| Session timeout + warning dialog                                         | `apps/nuxeo-ui/src/app/auth/`                         | Idle tracking, Material dialog                        |
| Theming (4 themes) + theme settings page                                 | `apps/nuxeo-ui/src/app/theme/`, `settings/themes`     | §3 Sass, §6 Material theming, feature flag            |
| i18n                                                                     | `apps/nuxeo-ui/src/app/i18n/`                         | §18 ngx-translate custom loader                       |
| Profile, Nuxeo Drive, Authorized Applications, Cloud Services settings   | `apps/nuxeo-ui/src/app/settings/`                     | Nuxeo `/token`, `/oauth2/*`, `nxdrive://`             |
| Personal space                                                           | `apps/nuxeo-ui/src/app/personal-space/`               | `User.GetUserWorkspace`                               |
| Contracts demo page                                                      | `apps/nuxeo-ui/src/app/features/contracts/`           | The only eagerly-routed page                          |
| Placeholder pages (recently-viewed, favorites, expired-queue, clipboard) | `apps/nuxeo-ui/src/app/placeholder-page.component.ts` | Routed but not implemented — know that they are stubs |

### Feature libraries

| Feature                       | Route                          | Capability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Extra technologies                                                                                     |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Browse** (largest)          | `/#/browse`                    | Folder tree, breadcrumbs, list/card/table views, sortable paginated tables, column picker with persisted settings, details panel, inline metadata editing, multi-select bulk actions (zip download, delete, add to collection, clipboard, compare, publish), create/import (single, multi-file, CSV server import), folder picker, CSV export, permissions with notification email, history, trash, Drive launch                                                                                                                                                                                                          | 82 signals, `ResizeObserver`, blob lifecycle, `localStorage`, §13 batch upload, §16 for the POC routes |
| **Document Detail** (richest) | `/#/doc/:uid`                  | Six tabs — View, Annotations, Permissions, History, Publishing, AI Insights. Preview of main blob and attachments, download, versions (create/restore/compare), permissions (add/edit/delete/external share/inheritance block), audit log, publishing and republish/unpublish, threaded comments with edit/reply/delete plus AI sentiment, tags with AI suggestions, favorites, subscription, lock/unlock, clipboard, trash/restore/permanent delete, workflow start and abandon, attachment upload/replace/remove, rich-text note editor, Drive launch, Content Lake ingestion, AI actions, Knowledge Enrichment actions | §18 Quill + DOMPurify, §17.1 five AI ops, §17.2 KE, Canvas, `ResizeObserver`, §15 extension outlets    |
| **Search**                    | `/#/search`                    | Faceted/aggregated search, filters drawer, natural-language→NXQL with AI suggestions, saved searches (create, share internally and externally), thumbnail grids, bulk actions, search queue                                                                                                                                                                                                                                                                                                                                                                                                                               | §17.1 `AI.NlToNxql`, `toSignal` + `toObservable`, §13 page providers                                   |
| **Assets**                    | `/#/documents`                 | Digital-asset results in grid or table, aggregation drawer, manageable columns, CSV export, saved searches, sorting, queue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `assets_search` page provider, blob lifecycle                                                          |
| **Collections**               | `/#/collections/:uid`          | Member listing with sort/paginate/search, add and remove members, edit and delete, permissions tab, history tab, export                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `Collection.Create`, `Document.AddToCollection`                                                        |
| **Tasks**                     | `/#/tasks`, `/#/tasks/:taskId` | Workflow inbox, task detail with the attached document previewed inline, form fields, completion and delegation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | §13 workflow and task APIs. **The simplest feature to read first — no RxJS at all.**                   |
| **Trash**                     | `/#/trash`                     | Grid/table/list views, filter drawer, restore and permanent delete (single and bulk), saved searches over trash                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `ecm:isTrashed`, trash operations                                                                      |
| **Administration**            | `/#/administration`            | Eight pages — Analytics (repository, distribution, workflow, search dashboards), Users & Groups, User Details, Group Details, Vocabularies, Audit log with AI search and summary, Cloud Services (OAuth2 providers/consumers/tokens), raw NXQL console. Three pages behind `fullAdministratorGuard`                                                                                                                                                                                                                                                                                                                       | §13 user/group/directory/audit/OAuth2 APIs, §17.1 three AI ops                                         |
| **Knowledge Discovery**       | `/#/knowledge-discovery`       | Agent selection, guardrail display, model info, answers rendered as segments with inline numbered citations openable in a dialog, question history, thumbs feedback, direct Content Lake upload, `?debug=1` diagnostic surface                                                                                                                                                                                                                                                                                                                                                                                            | §17.2 in full; 16 `switchMap` for answer polling                                                       |
| ~~**adf-hx Browse POC**~~     | ~~`/#/browse-adf-hx`~~         | Removed on 2026-10-14 (NXSAT-635); the path redirects to `/#/browse`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ~~**adf-hx Search POC**~~     | ~~`/#/search-adf-hx`~~         | Removed on 2026-10-14 (NXSAT-635); the path redirects to `/#/search`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Shared libraries

| Library                      | What it provides                                                                                                                                                                                   | Extra technologies                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `shared/nuxeo-client`        | 27 services, 16 models, ~50 utilities, 3 route guards, all configuration tokens                                                                                                                    | §13 in full. **Start here** — every feature depends on it |
| `shared/ui`                  | Document viewer (image zoom/rotate/fit, video storyboard, picture formats, EXIF/IPTC, ARender tab), compare dialog, confirm, export, saved-search and share dialogs, selection topbar, widget grid | Blob lifecycle, §21 ARender                               |
| `shared/extensions`          | Slot, rule, action and component registries; the manifest engine                                                                                                                                   | §15 in full                                               |
| `shared/app-config`          | Bootstrap config and runtime manifest loading                                                                                                                                                      | `APP_INITIALIZER`, §15                                    |
| ~~`shared/adf-hx-bridge`~~   | Removed on 2026-10-14 (NXSAT-635)                                                                                                                                                                  | —                                                         |
| `shared/ai-client`           | `AiGatewayService`, `AiChatService`, feature flag                                                                                                                                                  | §17.1                                                     |
| `shared/kd-client`           | KD operations, citation parsing (~22 utilities)                                                                                                                                                    | §17.2                                                     |
| `shared/ke-client`           | KE enrichment operations                                                                                                                                                                           | §17.2, multipart                                          |
| `shared/permission-dialogs`  | Four permission and external-sharing dialogs                                                                                                                                                       | §13 ACLs                                                  |
| `extensions/acme-extensions` | The reference customer extension library                                                                                                                                                           | §15 Layer 2                                               |
| `platform`                   | The published package root and five entry points                                                                                                                                                   | §19                                                       |

Two libraries have **no content** and exist only as scaffolds: `libs/core` (a placeholder
component) and `libs/shared/util` (a function returning a string). Do not go looking for meaning
there.

---

## Part VIII — Study plan

### Suggested sequence

The dependency order matters more than the pace. Each phase assumes the previous one.

| Phase                  | Weeks (part-time) | Modules                                                           | Outcome you can demonstrate                                                    |
| ---------------------- | ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **1 — Foundations**    | 1–3               | §1 Node, §2 TypeScript, §3 CSS/Sass, §4 Web APIs                  | Read any file in the repo without looking up syntax                            |
| **2 — Framework**      | 4–7               | §5 Angular, §7 RxJS, §6 Material                                  | Build a standalone page with signals, a service, a Material table and a dialog |
| **3 — Repository**     | 8–9               | §8 Nx, §9 build, §10 lint, §11 Vitest                             | Add a library with correct tags, wire its targets, get `beta:gate` green       |
| **4 — Domain**         | 10–13             | §13 Nuxeo, §14 auth/security                                      | Add a service method that calls a new Nuxeo endpoint, with tests               |
| **5 — The product**    | 14–16             | §15 extension contract, §16 adf-hx                                | Register a new action and rule; make a hardcoded list manifest-driven          |
| **6 — Specialisation** | 17–20             | §12 E2E, §17 AI/KD/KE, §18 libraries, §19–22 packaging, infra, CI | Ship a feature end to end with evidence and a green PR                         |

### Prove it to yourself — graduation exercises

Do these without assistance. Each one exercises a slice that a tutorial cannot.

1. **Add a document action.** A new toolbar action on document detail, registered by ID, gated by
   an existing rule, calling an Automation operation, with unit tests and a Playwright evidence
   step. Touches §5, §13, §15.
2. **Add a Nuxeo endpoint.** A new method on an existing service, with error paths tested, and
   `docs/api-integrations.md` plus `AGENTS/01-services.md` updated. Touches §7, §13, §11.
3. **Make something configurable.** Move a hardcoded list into Layer 0 or Layer 1 and prove a
   manifest change alters it without a rebuild. Touches §15.
4. **Fix a blob leak deliberately introduced.** Create an object URL without revoking it, observe
   the growth, then fix it properly. Touches §4, §5.
5. **Break a gate on purpose.** Pick any gate in §22.2, make it fail, understand the message, then
   fix it. This is the single most valuable hour in the whole plan.
6. **Build and install the marketplace package** against a local Nuxeo, then upgrade it and prove
   your Layer 0 configuration survived. Touches §20, §21.

### Reading the repository's own knowledge base

These are more accurate than any external resource for this codebase, and they are the first thing
to read each morning of Phase 4 onwards:

`AGENTS.md` · `AGENTS/00-architecture.md` · `01-services.md` (service method signatures) ·
`02-nuxeo-apis.md` · `03-angular-conventions.md` · `04-feature-scaffold.md` ·
`05-test-standards.md` · `06-git-workflow.md` · `07-security.md` ·
`08-bug-patterns.md` (10 anti-patterns with BAD/GOOD examples — read this one twice) ·
`09-pr-feedback.md` · `10-ai-features.md` · `11-beta-program.md` (§3 is verified facts) ·
`12-review-agents.md`

---

## Appendix A — Complete version matrix

Versions as resolved in `package-lock.json` at commit `e334b0f`. Where `package.json` declares a
range, the range follows in brackets.

**Four baselines, not one.** The Angular row was refreshed at `3f381e2` (#164), where the framework
moved to 20.3.31 to clear two advisories, and again at `b15d9cf` (NXSAT-303, #300) where it moved to
20.3.33 for GHSA-ff3f-86qr-9cv3 in `@angular/router`; the `dompurify` row was refreshed at that same
commit, 3.4.13 -> 3.4.16 for GHSA-p98j-92pf-mc4p. The `@hylandsoftware/satori-ui` row was refreshed at
`d500aae` (NXSAT-308, #332), 0.2.0 -> 0.2.1, the newest Satori on the Angular 20 line. Those three rows
do not come from `e334b0f` and cannot be reproduced there. **No other row has been re-verified since `e334b0f`**, and some may have
drifted — `axios` and `brace-expansion` also moved at `b15d9cf`, as `overrides` rather than declared
dependencies, and neither appears in this matrix at all. The honest fix is to re-baseline the whole
matrix against one revision, which is more than a version bump should carry. Until then, reproduce
the Angular and `dompurify` rows at `b15d9cf`, the Satori row at `d500aae` and the rest at `e334b0f`.

### Runtime dependencies

| Package                                                                                    | Resolved                                 |
| ------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `@angular/core`, `common`, `router`, `forms`, `compiler`, `animations`, `platform-browser` | 20.3.33 (`~20.3.33`)                     |
| `@angular/material`                                                                        | 20.2.14 (`~20.2.0`)                      |
| `@angular/cdk`                                                                             | 20.2.14 (`~20.2.0`)                      |
| `@angular/material-date-fns-adapter`                                                       | 20.2.14                                  |
| `@mat-datetimepicker/core`                                                                 | 16.0.1                                   |
| `rxjs`                                                                                     | 7.8.2 (`~7.8.0`)                         |
| `zone.js`                                                                                  | 0.15.1 (`~0.15.0`)                       |
| `tslib`                                                                                    | `^2.3.0`                                 |
| `@hylandsoftware/satori-ui`                                                                | 0.2.1 (`^0.2.1`)                         |
| `@ngx-translate/core`                                                                      | 17.0.0 (`^17.0.0`)                       |
| `angular-oauth2-oidc`                                                                      | 19.0.0 (unused)                          |
| `quill`                                                                                    | 2.0.3 (`^2.0.3`)                         |
| `dompurify`                                                                                | 3.4.16 (`^3.4.16`)                       |
| `pdfjs-dist`                                                                               | 6.2.108                                  |
| `cropperjs`                                                                                | 1.6.2                                    |
| `date-fns`                                                                                 | 2.30.0                                   |
| `minimatch`                                                                                | 10.2.6                                   |
| `ng-mocks`                                                                                 | `file:tools/stubs/ng-mocks` (local stub) |

### Build and development

| Package                                                     | Resolved                                  |
| ----------------------------------------------------------- | ----------------------------------------- |
| `typescript`                                                | 5.8.3 (`~5.8.0`)                          |
| `nx` and all `@nx/*`                                        | 22.7.8                                    |
| `@angular/cli`, `@angular/build`, `@angular-devkit/*`       | 20.3.x                                    |
| `ng-packagr`                                                | 20.3.2                                    |
| `vite`                                                      | 6.4.3 (pinned by `overrides`)             |
| `esbuild`                                                   | 0.28.1 (pinned by `overrides`)            |
| `vitest`, `@vitest/coverage-v8`, `@vitest/ui`               | 3.2.7                                     |
| `jsdom`                                                     | 28.1.0                                    |
| `@analogjs/vite-plugin-angular`, `@analogjs/vitest-angular` | 1.22.5                                    |
| `eslint`                                                    | 9.39.5                                    |
| `typescript-eslint`                                         | 8.x                                       |
| `angular-eslint`                                            | 20.x                                      |
| `prettier`                                                  | 3.9.6                                     |
| `sass`                                                      | 1.102.0                                   |
| `husky`                                                     | 9.1.7                                     |
| `lint-staged`                                               | 16.4.0                                    |
| `@swc/core`                                                 | ~1.15.5                                   |
| `@playwright/test`, `@axe-core/playwright`                  | **untracked**, installed with `--no-save` |
| `knip`                                                      | invoked via `npx` in the weekly workflow  |

### Platform and infrastructure

| Item                  | Version               |
| --------------------- | --------------------- |
| Node.js               | 20.x (pinned)         |
| npm                   | 11.6.2                |
| Java                  | 21                    |
| Maven                 | 3.9+                  |
| `nuxeo-parent`        | 11.5.154              |
| Nuxeo target platform | `lts [2025.0,2026.0)` |
| OpenSearch            | 2.17.1                |
| Mailpit               | v1.22.3               |
| ARender               | 2023.19.0             |
| nginx                 | `alpine`              |

---

## Appendix B — Known documentation drift

Flagged during the audit that produced this document, so that a learner does not trust a stale page
and lose a day. These should be fixed in the `AGENTS/` knowledge base.

1. **`AGENTS/10-ai-features.md`** documents `libs/shared/ai-client/src/lib/ai.service.ts` with
   content-based signatures such as `summarize(content, title)`. That file does not exist; the real
   `AiGatewayService` takes `docId` / `userId`.
2. **`AGENTS/02-nuxeo-apis.md`** documents `GET /id/:uid/@versions`, which returns 404 on this
   distribution. The code uses the `Document.GetVersions` operation.
3. **`AGENTS/02-nuxeo-apis.md`** names `Blob.Attach`; the source calls `Blob.AttachOnDocument`.
4. **`AGENTS/00-architecture.md`** says dev credentials come from `environment.ts`. No
   `src/environments/` directory exists — configuration comes from the Layer 0 bootstrap file.
5. **`AGENTS/02-nuxeo-apis.md`** omits the `@comment` adapter, `Document.Copy` / `Document.Move`,
   and the `/config/*` content-model endpoints, all of which are called from source.
6. **`AGENTS.md` §3 and §8** describe "23 services". There are **27** service files in
   `libs/shared/nuxeo-client/src/lib/services/`. The weekly `staleness-check.yml` workflow diffs
   exactly this, so the drift is already being reported.
7. **`documentation/30-engineering/05-technology-stack.md`** lists Nx 22.6.3 (now 22.7.8),
   DOMPurify `^3.3.3` (now `^3.4.16`), Java 17+ (the POM requires 21), and two unused
   dependencies — `openai` and `express` — that are no longer in `package.json`.

---

## Appendix C — What you can safely skip

Time saved is as valuable as time spent. Nothing in this list appears anywhere in `apps/` or
`libs/`, so a tutorial that insists it is essential is not describing this codebase.

- **NgModules** — zero in the repository
- **Zoneless change detection, SSR, hydration, Angular Universal** — not adopted
- **`resource()` / `httpResource()`** — Angular 20's newer async primitives are not used
- **Route resolvers** — none; data loads in components
- **NgRx, Akita, or any global state library** — signals and services only
- **Webpack** — the build is esbuild/Vite via `@angular/build:application`
- **Karma and Jasmine** — declared but vestigial; Vitest is the real runner
- **OIDC, JWT, Keycloak** — the OIDC package is present but unused
- **Web Workers, IndexedDB, Service Workers, WebSockets, SSE, `IntersectionObserver`,
  `MutationObserver`, `AbortController`**
- **Angular CDK overlay, drag-drop, virtual scroll** — only `cdk/keycodes` is used
- **Client-side LLM calls** — every AI call is a server-side Nuxeo Automation operation. The
  absence of an `openai` dependency is deliberate and should stay that way.
