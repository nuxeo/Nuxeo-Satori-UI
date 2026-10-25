# Angular 21 → 22 (NXSAT-670)

What moved, what Angular 22 changed underneath us, and the decision taken for each change. Every
decision below preserves Angular 21 behaviour unless it says otherwise; adopting the new defaults
(OnPush, fetch, incremental hydration) is separate work, done one surface at a time with tests.

Sources: the 22.0.0 sections of the Angular and Angular Components changelogs, the TypeScript 6.0
release notes, and the migration manifests shipped in `@angular/core@22.2.3`,
`@schematics/angular@22.2.4`, `@angular/material@22.2.4` and `nx@23.3.0`.

## Versions

| Package                                       | Angular 21 state | Angular 22 state |
| --------------------------------------------- | ---------------- | ---------------- |
| `@angular/*` framework                        | 21.2.25          | 22.2.3           |
| `@angular/cli`, `build`, `devkit`             | 21.2.27          | 22.2.4           |
| `@angular/material`, `cdk`, date adapter      | 21.2.14          | 22.2.4           |
| TypeScript                                    | 5.9.3            | 6.0.3            |
| `nx`, `@nx/*`                                 | 22.7.8           | 23.3.0           |
| Vite (workspace and both Angular builders)    | 7.3.7            | 8.3.5            |
| `zone.js`                                     | 0.15.1           | 0.16.3           |
| `ng-packagr`                                  | 21.2.7           | 22.2.5           |
| `angular-eslint`                              | 21.4.0           | 22.6.0           |
| `@hylandsoftware/satori-ui`                   | 0.3.3            | 0.4.2            |
| Node.js (`.nvmrc`, `engines`, every workflow) | 20.x             | 24.x             |

Vitest stays on 4.1.10 and ngx-translate on 17. Vitest 5 is not needed by anything here. ngx-translate
18 is NXSAT-671 and has to land with the Satori 1.0 alpha (NXSAT-673): `satori-ui` 0.4.2 peers
`@ngx-translate/core ^17`, and `1.0.0-alpha.171` peers `^18` and Angular `>=22 <23`.

## Node 24

Angular 22 refuses to start on Node 20: `@angular/core`, the CLI, the builder, `compiler-cli` and
`ng-packagr` all declare `^22.22.3 || ^24.15.0 || >=26`. Node 24 is the LTS with the longer runway.
On Node 24 the built-in `localStorage` is still off by default (`typeof localStorage` is
`undefined`, so jsdom's is used); Node 25 is the first major where it is on and throws, so the
gate's `--no-experimental-webstorage` workaround is still needed only above the pin.

## Behaviour changes, and what was done

### Components default to OnPush

A component with no `changeDetection` is `OnPush` under Angular 22. 84 of the 142 source
components had none; the `change-detection-eager` migration gave each
`ChangeDetectionStrategy.Eager`, which is the Angular 21 behaviour under its new name. The other
58 were already `OnPush`. Every spec host component is `Eager` too, 118 of them.

The migration only analyses the TypeScript programs it can find through the workspace's targets.
Its first pass, under `nx migrate`, reached 81 of the 84 source components and 31 of the 118 spec
hosts, because most spec tsconfigs and a few library tsconfigs are named by no target it reads.
It was run again with every library's tsconfig registered temporarily in `angular.json`, which was
restored byte for byte afterwards. It still skipped six components declared inside a test
function; those were given `Eager` by hand. No `@Component` in the tree is left without an explicit
strategy. The Material and CDK v22 schematics were run over the same full set and changed
nothing.

**angular-eslint 22 forbids exactly that opt-out.** `prefer-on-push-component-change-detection`
ships in the 22 preset and fails on every explicit `Eager`: 126 errors across 11 projects
(`ui`, `satori-components`, `satori-components-satori`, `document-layouts`, `document-detail`,
`administration`, `assets`, `search`, `browse`, `tasks`, `core`), and no other error class in the
whole workspace. Preserving Angular 21 behaviour and satisfying the rule are mutually exclusive, so
one had to give.

The rule is **off**, in the root `eslint.config.mjs`, with the reason and a 2027-06-30 revisit
beside it. Not a suppression to reach green: the alternative is to adopt OnPush across 84 source
components, which needs a per-surface check that change detection still fires and is the separate
work this document already scopes out. Deleting that one line reports every component still to
convert, so the list is recoverable rather than lost. Lint is green on all 30 projects with it, and
was 126 errors without it.

### `HttpClient` uses fetch by default, and fetch cannot report upload progress

`FetchBackend` is the default backend in 22. A request with `reportProgress` still completes, but no
`UploadProgress` event is ever emitted. `DocumentImportService.uploadFileToBatch` drives the import
queue's per-file percentage from exactly those events. Both applications and the Storybook preview
now call `provideHttpClient(withXhr(), …)`.

No existing spec could see this: every spec of the import service replaces the backend with
`HttpTestingController`. `apps/nuxeo-ui/src/app/app-http-backend.spec.ts` runs the real
`appConfig.providers` with only the browser's XHR replaced and requires the upload to open on an
`XMLHttpRequest`, not to go through `fetch`, and to emit `UploadProgress`. It fails, on all three
assertions, with `withXhr()` removed from `app.config.ts`.

### Optional chaining in templates returns `undefined`, not `null`

The `safe-optional-chaining` migration wrapped three expressions in `$safeNavigationMigration(…)`,
which restores `null`. Each wrapper was removed after checking what reads the value:

- `browse.html`, `currentDoc()?.type | docTypeLabel` — the pipe returns `''` for any falsy type.
- `browse.html`, `[documentType]` on `nxs-domain-hint` — read only by `type === 'Domain'`.
- `permissions-panel.component.html`, `{ principal: edit.item?.principal }` — **this one would
  differ**: ngx-translate renders `null` as the text "null" and leaves `{{principal}}` in place for
  `undefined`. It is safe because that branch is the editor's `'edit'` mode, which is entered in
  one place only, `openEdit(item: LocalItem)`, and `LocalItem.principal` is a required string.

### `nullishCoalescingNotNullable` and `optionalChainNotNullable` are no longer silenced

The `strict-safe-navigation-narrow` migration suppresses both diagnostics in every tsconfig, on the
expectation that narrowing makes them fire on existing code. They were measured instead: every one
of the 20 projects with templates compiled with both checks at `warning` produced **zero**
occurrences, and a planted template that should trip both produced one of each, so the
measurement is not vacuous. The suppression was removed from all 47 tsconfigs; each file's
`angularCompilerOptions` is now identical to its Angular 21 version.

### `strictTemplates` defaults to `true`

Every project with templates already set it. The migration also added `strictTemplates: false` to
eight tsconfigs in five projects (`integration-tests`, `ai-client`, `testing`, `util`,
`satori-generators`) whose programs compile no Angular decorator, so it changed nothing and was
reverted.

### Router `paramsInheritanceStrategy` defaults to `'always'`

A child route now inherits its parents' params, data and resolved data. Audited rather than
pinned: no parent route in either application or any feature library carries params, `data` or
`resolve`. Route params live on leaf routes (`:uid`, `:taskId`, `user/:userId`), and the extension
routes put their `data` on the contributed leaf. The behaviour is therefore unchanged; set
`withRouterConfig({ paramsInheritanceStrategy: 'emptyOnly' })` if a parent ever gains data a child
must not see.

### Removed APIs

None was in use: `ComponentFactoryResolver`, `createNgModuleRef`, `ChangeDetectorRef.checkNoChanges`,
`provideRoutes`, the Hammer.js integration, `CanMatch` without its third argument,
`TitleStrategy.getResolvedTitleForRoute`, and in Material and the CDK `MatListOption.checkboxPosition`,
the `FocusTrap` constructor changes, `ContextMenuTracker` and `DropListRef.drop`. `data-` attributes
no longer bind inputs; none of the six `data-*` names in our templates is an input name.

## TypeScript 6

TypeScript 6 makes several options deprecation errors and changes several defaults. The Nx
migrations made the 5.9 behaviour explicit instead of adopting the new behaviour:

- `tsconfig.base.json` sets `"ignoreDeprecations": "6.0"` once, for `baseUrl`,
  `esModuleInterop: false` and the generators' `moduleResolution: "node"`. The migration had put it
  in 33 files; all of them extend the base, so 32 copies were removed. TypeScript 7 removes these
  options outright, so they have to go before that upgrade.
- The base also pins the old defaults of `strict` (`false`; every project tsconfig sets `true`),
  `noUncheckedSideEffectImports` and `types` (`["*"]`).
- `rootDir` is set explicitly in 53 project tsconfigs, at the directory TypeScript 5 inferred.

`scripts/build-platform-generators.mjs` invokes `tsc` with flags rather than a tsconfig, which
TypeScript 6 refuses while a `tsconfig.json` is in the working directory (TS5112). It now passes
`--ignoreConfig`, `--ignoreDeprecations 6.0` and `--types node`. The five generators it emits into
`@nuxeo/satori-platform` are **byte-identical** to the TypeScript 5.9 output.

## Toolchain

- **Vite 8.** `@angular/build` 22 depends on Vite 8, so the workspace moved with it rather than
  running two majors side by side. The security overrides that pin Vite under both Angular build
  packages moved to 8.3.5. No config used `rollupOptions`. The vitest configs use
  `import.meta.dirname` instead of `__dirname`, and `vitest.workspace.ts` is deleted with nothing in
  its place — see
  [the Angular 21 record](angular-21-migration.md#vitestworkspacets-is-ignored-and-must-not-become-a-root-vitestconfigts)
  for why a root `vitest.config.ts` is the wrong replacement. Nx 23 happens not to infer a project
  from one, where Nx 22 does, so this branch carried the hazard without showing it.
- **Overrides.** Every override is checked against the declared ranges of the packages that depend
  on it, because an override forcing a dependent below its range is a downgrade nobody chose.
  `piscina`, `postcss`, `webpack-dev-server`, `http-proxy-middleware`, `smol-toml`, `esbuild` and
  `@angular-devkit/architect` moved up to what Angular 22 and Nx 23 declare.

  Two survived that pass and were caught afterwards, by auditing every override rather than the
  ones the bump touched: `postcss` 8.5.28 against the `^8.5.30` Vite 8.3.5 declares, and `qs`
  6.15.3 against the `^6.16.0` Express 5.3.0 declares — the second was never in the list at all.
  Both are now floors: `postcss` 8.5.31, `qs` 6.16.1. The audit is per-override and whole-tree, not
  per-bump, because the dependent's range moves on its own: Vite raised its `postcss` floor when it
  went to 8.3.5, which turned an override that had been correct into a downgrade without anything
  in this repository changing.

  Every remaining override sits at or above its dependents' declared minimum, checked with
  `semver.minVersion`. A mismatch is only a defect in one direction — above is a security floor,
  below is a downgrade — so the count alone does not say whether anything is wrong.

- **`zone.js` 0.16** drops Internet Explorer and the non-Chromium Edge, neither of which is
  supported.

## `@hylandsoftware/satori-ui` 0.4

0.4 renames its classes with a `Sat` prefix (`AppHeader` → `SatAppHeader`) and keeps the old names
as aliases, so no import changed. It also adds a minimum height to the subscript of every form field
without a hint or an error. That moves every form in the product, so `nuxeo-ui` opts out with
`provideSatori({ subscriptSizing: false })` until design signs the spacing off. The Satori Storybook
keeps Satori's default, because it demonstrates what a Satori host gets.

## Validation

Run from a dedicated worktree on Node 24, with `NX_WORKSPACE_ROOT_PATH` unset and the Nx cache
isolated. The gate ran clean; the backend suite ran against a live Nuxeo instance (Docker, port 8080) with `NUXEO_USER`/`NUXEO_PASS` set and every `AWS_*` variable stripped.

### Gate and static checks

| Check            | Result                                           |
| ---------------- | ------------------------------------------------ |
| `beta:gate`      | **pass, 32 of 33** (code-scanning NOT RUN)       |
| Affected lint    | pass, 30 projects                                |
| Affected tests   | pass                                             |
| Affected build   | pass                                             |
| Affected typeck  | pass                                             |
| Coverage gate    | pass (baseline re-recorded for Vitest 4)         |
| Storybook builds | pass (token-free + satori + interactions)        |
| Publishability   | pass (7 entry points typecheck standalone)       |
| Peer install     | pass (installs from public npm, no GitHub auth)  |
| API surface      | pass (re-recorded for TS 6 / ng-packagr 22 emit) |

The gate is identical to the Angular 20 baseline and Angular 21: 32 green, `code-scanning` NOT RUN
(it needs a PR, so every local run reports it this way). Six defects were found and fixed during
validation — all pre-existing on the Angular 22 branch, none introduced by the merge from 669:

1. **Lint red (126 errors):** `@angular-eslint/prefer-on-push-component-change-detection` forbids
   the explicit `Eager` strategy the `change-detection-eager` migration added to preserve Angular
   21 behaviour. Rule turned off with documented reason and 2027-06-30 revisit; 126 → 0.
2. **Override downgrades:** `postcss` 8.5.28 and `qs` 6.15.3 forced dependents below their
   declared ranges (`^8.5.30` and `^6.16.0`). Raised to 8.5.31 and 6.16.1.
3. **Lockfile selftest:** control 19 was green-by-vacuity — it removed `brace-expansion@^5.0.0`,
   which Nx 23 no longer needs, so removing it changed nothing. Now searches for any load-bearing
   key; found `@angular/build`.
4. **`api-surface` red (2300+ line diff):** ng-packagr 22 / TypeScript 6 emit inline
   `import("@angular/core").X` where 21 hoisted `_angular_core.X`. Proved 0 public-surface
   differences and 74 internal `ɵ` members, all of them `ɵprov` going to `<any>`. Re-recorded.
5. **`publishability` red:** TypeScript 6 rejects `baseUrl`, so the gate's declaration typecheck
   could not run and correctly refused to report a pass. `baseUrl: '.'` dropped (never needed).
6. **`peer-installability` red:** ng-packagr flattens declarations to
   `types/nuxeo-satori-platform-components-satori.d.ts`, which matched neither
   `-components-satori.mjs` nor `/components-satori/`. The one file allowed to import Satori was
   reported as leaking. Fixed path match to `-components-satori.` with trailing dot.

Three of the six (4, 5, 6) share the same root cause: ng-packagr and TypeScript changed how they
emit declarations, and the harness had the old shape hardcoded. NXSAT-669's commit `1176c22d2`
fixed `publishability` and `upgrade-rehearsal` for this; `peer-installability` was missed then.

### Backend suite (live Nuxeo on Docker, Node 24)

| Check        | Result                                                                |
| ------------ | --------------------------------------------------------------------- |
| i18n audit   | pass (pseudo-locale rendering, translation coverage)                  |
| integration  | pass (live backend operations via Vitest)                             |
| e2e          | **41 pass, 8 fail** — 7 pre-existing WebKit, 1 chromium environmental |
| Runtime a11y | not measured (setup: Playwright/axe version mismatch)                 |

#### e2e breakdown

The 8 failures are **not regressions**:

- **7 WebKit failures** reproduce on the Angular 20 baseline: `blob-URL images actually decode`,
  `dates render on every listing surface`, `Log in shows a visible focus indicator`, `login form
stays usable in forced-colors`, `skip link is first in tab order`, `offers navigation into the
repository tree`, and `the session survives a real reload`.
- **1 chromium failure** is environmental, not a regression: `dates render on every listing
surface` fails because the page visits `/#/search` with no query and expects date-formatted
  results, but the default filter chips (`Validated` + `No Containers`) match zero documents in
  this Nuxeo instance's current data. The page renders the honest empty state: `2204 results` in
  the facets, zero rows, `No documents match the search criteria`. **Control:** the same test
  fails identically on Angular 21 against the same Nuxeo (Node 20, port 4234), proving it is
  data-dependent rather than an Angular 22 change.

#### a11y

Runtime a11y checks were not measured. The initial run installed Playwright 1.64.1 and
`@axe-core/playwright` 4.14.0 unpinned; the preflight correctly refused to run because the
baseline was measured against 4.13.0 and axe rule sets move between versions. A second run at the
pinned versions (1.63.0 / 4.13.0) was started but the evidence directory for it is incomplete.

Template a11y (`npm run a11y`, which reads one static HTML snapshot per surface) also failed
setup: `Cannot read properties of undefined (reading 'accessibility')`. Both are tooling issues,
not product defects, and are out of scope for this migration's validation — the same tools and
pins will be used for all three Angular versions (20, 21, 22) when the full a11y pass runs.

### Evidence location

Gate logs, suite output and the eight commits are saved to
`~/Desktop/agentic-ui-evidence/NXSAT-670/validation/`, outside the repository.
