# Beta Program — Nuxeo Satori Component Platform

Context every agent needs before doing Beta work. Read this **after** `AGENTS.md`
and alongside `AGENTS/00-architecture.md`.

**RFC:** "RFC: Nuxeo Satori Beta - Component Platform and Customer Extensibility Model"
**Tickets:** NXENG-619 (Discovery) under NXENG-615 (Epic)
**Harness:** `scripts/beta-harness/` · **Entry skill:** `beta-phase`

---

## 1. What we are building, in one paragraph

A deep core ECM slice — browse, folder tree, search, document detail, metadata,
permissions, versions, upload and CRUD — built on real `adf-hx` components and
made customisable through a four-layer extensibility contract. Workflow, users
and groups, administration and publishing are **out of scope for Beta**.

_Changed by NXSAT-308 (2026-10):_ the slice is now built on our own `nxs-` components in
`libs/shared/satori-components`. adf-hx, ADF and the adf-hx POC routes were removed
(NXSAT-635, NXSAT-636, NXSAT-637); the four-layer contract is unchanged.

The governing principle: **the extension contract is the product; AI agents are
the accelerator.** Customers customise through a documented, versioned API. They
do not edit our source, and neither do their agents.

---

## 2. The four layers

| Layer                  | Surface                                                                 | Customer writes     | Build needed       |
| ---------------------- | ----------------------------------------------------------------------- | ------------------- | ------------------ |
| 0 — Configuration      | Theme tokens, nav items, action visibility, presets, labels             | JSON, CSS variables | No                 |
| 1 — Declarative wiring | Manifest references components, rules, actions, routes by registered ID | JSON                | No                 |
| 2 — Customer code      | New components, actions, rules, guards in their own library             | TypeScript          | Yes, in their repo |
| 3 — Agent harness      | Knowledge base, generators, runnable guardrails                         | Prompts             | Yes, in their repo |

When implementing anything, ask which layer it belongs to. Behaviour that a
manifest can express must not be hardcoded; behaviour that needs code must not
be faked in configuration.

---

## 3. Verified facts — do not re-litigate these

These were established by first-hand inspection of the published artifact.
Treat them as settled; if you contradict one, prove it first.

_Changed by NXSAT-635 to NXSAT-638 (2026-10):_ adf-hx and ADF are no longer in the
product. NXSAT-635 removed the `/#/browse-adf-hx` and `/#/search-adf-hx` POC routes and
`libs/shared/adf-hx-bridge` (the API ports, `ADF_HX_NUXEO_BRIDGE_PROVIDERS` and its `providers`
entry point); NXSAT-637 removed the packages, and NXSAT-638 made the `dependency-tree` gate
blocking, which keeps them out. The adf-hx facts below are kept as the record of what was established. Where one names the
bridge, its providers or a POC route as present, that code no longer exists.

- **CI runs on this branch and passes.** `ci.yml` triggers on `push` as well as on
  `pull_request`, so a long-lived feature branch is validated without a PR. Run
  32480243192 is `completed success` on Node 20. Two phase reviews disagreed about
  this — one claimed "CI has still never run against it" — and the claim that it had
  run was the correct one. No pull request has been opened, so only the PR-triggered
  path is unexercised.
- **`SATORI_GH_READONLY_TOKEN` is set as a repository secret**, since 2026-08-03,
  and `read:packages` resolves both `@alfresco` and `@hylandsoftware`. The plan's
  open `token-request` item is closed for CI. Statements that the secret was never
  provisioned are stale.
- **Only a CI run is authoritative.** Local gates here run on Node 25 with a
  `--no-experimental-webstorage` workaround; the repo pins Node 20 and CI uses it.
  A local green is necessary, not sufficient.
  _Changed by NXSAT-669 (2026-10):_ the pin is now Node 24, because Angular 22 refuses Node 20,
  and CI runs Node 24. The rule itself stands: only the CI run is authoritative.

  **So check it, every time you push.** This rule was stated here and then broken over
  twenty consecutive pushes while "CI green" was reported from local gates alone; CI was
  red for sixteen of those runs. The push does not tell you:

  ```bash
  gh run list --branch feature/adf-hx-browse-poc --limit 3 \
    --json status,conclusion,headSha,event
  ```

  Note that `concurrency.cancel-in-progress` is on, so pushing again **cancels** the
  previous run. A `cancelled` conclusion on an earlier commit is expected, not a failure —
  but it also means only the newest run has actually verified anything.

- `@alfresco/adf-hx-content-services` **is installable** with a `read:packages`
  token. 648 published versions. `latest` = `7.20.0-automate.292`,
  `beta` = `7.21.0-automate.86`.
- **There has been no stable release in twelve months.** The last true stable,
  `7.19.5`, is from August 2025 with an Angular 15 baseline. We pin an exact
  prerelease, never a dist-tag.
- adf-hx exposes **twelve API ports as overridable injection tokens** —
  `CHECKIN`, `COPY`, `DOCUMENT`, `DOWNLOAD`, `GROUP`, `MODEL`, `MOVE`, `QUERY`,
  `RENDITIONS`, `UPLOAD`, `USER`, `VERSION` — plus the aggregate
  `ADF_HX_CONTENT_SERVICES_API_PROVIDERS`. This is the substitution point the
  whole plan rests on.
- Its **dependency contract is under-declared**: one peer declared
  (`@angular/core >=19.2.9`) and one runtime dependency (`tslib`) against thirteen
  packages actually imported. We maintain the true pin set ourselves. Counted from
  the `7.20.0-automate.292` tarball, the load-bearing ones by import count are
  `@hylandsoftware/hxcs-js-client` (151), `@alfresco/adf-core` (66), `@ngx-translate/core`
  (48), `@alfresco/adf-extensions` (13) and `@alfresco/js-api` (2), plus seven
  `@angular/material` entry points and `@angular/cdk/collections`. **`npm install`
  brings none of them and warns about none of them** — a missing pin surfaces as a
  build error, not a dependency error, so budget Phase 3's spike for resolving the
  set by hand.
- `@alfresco/adf-extensions@9.0.0` is on **public npm**, runtime dependency
  `tslib` only, and is **installed and in use** as of Phase 2. Layers 0 and 1 need
  no privileged access. Three corrections established by installing it:
  - It declares three peers but its public `.d.ts` also imports
    `@angular/material/menu` and `@angular/router`, so it is **under-declared in
    the same way adf-hx is**. A second data point for R2, not a one-off.
  - Its shipped `index.d.ts` does **not** typecheck under `skipLibCheck: false` —
    six intrinsic `TS2411` index-signature errors, independent of missing peers.
    Consuming it requires `skipLibCheck: true`, which this repo already sets.
  - `@alfresco/js-api` is a mandatory peer but a **types-only** import: the
    runtime `.mjs` never references it. It is therefore a devDependency here, so
    a 7 MB Alfresco Content Services REST client does not ship inside a Nuxeo
    product to satisfy a compile-time constraint.
- **adf-extensions' `RuleContext` is Alfresco-domain-shaped** (`NodeEntry`,
  `SiteEntry`, `RepositoryInfo`), describing a repository we do not talk to. Our
  rule context is our own, in upstream's _shape_ but not its types; reusing
  upstream's would put ACS types in the signature every customer rule is written
  against. Its domain-neutral parts — `mergeObjects`, `mergeArrays`,
  `filterEnabled`, `sortByOrder`, `getValue` — are used directly.
- **~~One registry serves every `@alfresco` package we need~~ — superseded by
  NXSAT-637**, which removed the last `@alfresco` package and the `@alfresco:registry`
  line from `.npmrc`. True when written: `@alfresco:registry` pointed at GitHub
  Packages, and all four — `adf-extensions`, `js-api`, `adf-core` and
  `adf-hx-content-services` — downloaded from it, verified twice by fetching the
  tarballs with only that mapping present. adf-extensions, adf-core and js-api were
  _also_ on public npm, which made a two-registry split look necessary; it was not.
- **~~CI requires the token to carry `read:packages` for the Alfresco org~~ —
  superseded by NXSAT-637.** It did while `@alfresco/adf-extensions` was a production
  dependency. With no `@alfresco` package left, `SATORI_GH_READONLY_TOKEN` needs
  `read:packages` on the Hyland org only.
- **`.npmrc` alone does not decide where CI fetches from — `package-lock.json`
  does.** `npm ci` installs from each entry's `resolved` URL and ignores the
  registry mapping. After changing a scope's registry you must regenerate the
  lock, or CI will keep fetching from the old host and any claim about token
  scope is untested.
- **Never run a bare `npm install` on macOS and commit the lockfile.** It prunes
  optional platform entries that Linux needs — `@oxc-resolver/binding-wasm32-wasi`'s
  nested `@emnapi/core` and `@emnapi/runtime` at 1.11.2 — and `npm ci` on the
  Linux runner then refuses the whole tree. This broke CI for the length of
  Phase 2. `--os`/`--cpu` do not restore them; recover by restoring a known-good
  lock and merging only the new entries in.
- **Layer 1 slots are additive by construction.** `ExtensionSlotRegistry` keys
  slots by opaque string with no enum, union or `switch` on slot identity, so a
  tenth slot requires no change to the nine. Do not introduce a central slot
  dispatch; it would undo the property the Beta addressable-surface decision
  rests on. `rules` was removed from `EXTENSION_SLOTS`: rules are not descriptors
  and live in `ExtensionRuleRegistry`, so `slots.rules` was silently inert.
- **A slot id existing does not mean anything reads it.** The principle stands; the
  inventory below it was **wrong about `documentList` from Phase 3 onwards** and is
  corrected here. `documentList` is registered with twelve packaged columns in
  `provide-app-extensions.ts` and resolved by **both** browse routes. As of NXSAT-316,
  nine slots and none reserved: `navbar`, `bulk-actions`, `documentList`, `toolbar`,
  `contextMenu` and `tabs` have packaged descriptors and a host; `sidebar`, `routes` and
  `documentView` are resolved but have no packaged descriptor. NXSAT-630 added three more,
  one per layout mode, each resolved with no packaged descriptor: `documentMetadata`,
  `documentEdit` and `documentCreate` — the last read only by the create form, which no
  screen opens yet. The earlier "`routes`,
  `toolbar`, `contextMenu` and `tabs` are reserved" was stale long before that — each had
  gained a host. Do not describe a reserved id as an extension point — and do not
  trust this list either: `npm run beta:reference` checks every slot-state claim in
  `docs/extension-reference.md` against the source, which is why the drift was found. A
  hand-maintained inventory in a "do not re-litigate" section is the worst place for a
  fact that changes every phase.
- **An unregistered rule id fails open, except for a declared list.** A manifest
  naming a rule this build does not have leaves the entry visible; Layer 1
  visibility is not an authorisation boundary, and failing closed would let a
  typo strip working actions out of the UI. `SECURITY_RELEVANT_RULE_IDS` — the
  three user rules, including `app.rules.hasAdministrationAccess` — fail
  **closed** instead. The list is declared rather than attached at registration,
  because the unsafe window is exactly the one before registration happens: that
  rule is contributed by the shell's `APP_INITIALIZER`, so any consumer resolving
  the navbar earlier saw an unknown id and got `true`, which would have offered
  Administration to every user. `rule: null` still ungates deliberately.
- **`core.not` is NOR, not NAND.** Upstream is `args.every(arg => !evaluator(...))`.
  Phase 2 shipped `!args.every(evaluator)`, which agrees for one argument and
  diverges from two upwards while the file claimed ACA parity. Corrected, with a
  multi-argument test.
- **The rule context has three independently populated halves.** `document` is
  written by document detail alone and cleared on destroy, so the document rules —
  including `app.rules.isType` and `app.rules.hasFacet` — answer `false` on every
  other surface. `selectionCount` is populated from
  `SelectionService`, so the cardinality rules are live. `selection` — the
  documents — is **still empty**, because `SelectionService` tracks ids, so
  `canWriteSelection` and `canRemoveSelection` still answer `false`. Do not
  collapse `selectionCount` into `selection.length`; that is what keeps the
  distinction honest.
- **~~No library under `libs/` has a `build` target~~ — superseded by Phase 4.**
  `libs/platform` and `libs/shared/util` both have one today. The original fact was
  true when written and the _reason_ still holds:
  `@nx/enforce-module-boundaries`'s `enforceBuildableLibDependency` forbids a buildable
  library importing a non-buildable one, so a `build` target cascades through the
  dependency chain. Phase 4 resolved it the other way — `libs/platform` is a
  single buildable package whose four secondary entry points point _at_ the shared
  library sources, so nothing under `libs/shared/` needs a target of its own.
  `typecheck` remains the per-library gate, and still catches what `test` cannot.
- **`libs/platform/tsconfig.lib.json` is the _entire_ compiler configuration for the
  published package, not a set of overrides.** `@nx/angular:package` given a `tsConfig`
  option calls `parseRemappedTsConfigAndMergeDefaults`, which despite its name merges
  eight hardcoded options and otherwise **replaces** ng-packagr's bundled
  `conf/tsconfig.ngc.json`. Anything that file does not restate is lost, and Angular's own
  defaults are not the library-appropriate ones. This has produced two separate defects,
  both configuration _absent_ rather than wrong, so no compiler reported either:
  - omitting `strict` shipped 27 wrongly non-nullable public types;
  - omitting `compilationMode: "partial"` made the package **unpublishable** —
    ng-packagr writes a `prepublishOnly` that hard-fails `npm publish` for a full-mode
    build — for the whole of Phase 4, while the phase claimed an upgrade is an
    `npm version` bump.

  `npm run beta:publishable` runs a real `npm publish --dry-run` and is the only check
  that executes `prepublishOnly`. If you touch that tsconfig, run it.

- **A `depConstraints` of `sourceTag: '*' → onlyDependOnLibsWithTags: ['*']` enforces
  nothing.** That was Nx's scaffolded default and sat in `eslint.config.mjs` at severity
  `error` for the whole programme without rejecting a single edge, while CLAUDE.md listed
  "never cross-feature imports" as non-negotiable. Four violations accumulated. Real
  constraints are in place now, and **an untagged project cannot depend on anything** — a
  new library needs `scope:` and `type:` tags before it can import.
- **`npm ci` is not what catches a macOS-pruned lockfile.** `npm ci --dry-run`
  only demands the entries the current platform resolves, so on macOS it never
  looks at the pruned Linux subtree and passes. The `lockfile` gate checks the
  invariant directly: every non-optional dependency edge in the lock must resolve
  within the lock. It is the first gate because it is the failure the other five
  structurally cannot see.
- **The local Nuxeo has anonymous authentication enabled, and that makes "unauthenticated"
  untestable here.** `GET /nuxeo/api/v1/me` with **no credentials at all** returns HTTP 200
  and `{ id: 'Anonymous' }`, both through the dev proxy and directly on :8080. With no
  stored session, `AuthService.runHydration()` falls through to
  `tryEstablishCookieSessionOnly()`, which probes `/me` — the intentional SSO-detection
  path, since an SSO cookie is how a real deployment signs a user in without a form. The
  server says "you are Anonymous", the app believes it, and `isAuthenticated()` is true.

  So `authGuard` **is** sound and an E2E spec asserting "an unauthenticated visitor is
  redirected to /login" will fail against this environment for reasons that have nothing to
  do with the product. Removing Playwright's `httpCredentials` does not help: credentials
  were never what made `/me` succeed. Assert the two behaviours that are observable
  instead — an explicitly signed-out visitor **is** redirected (`runHydration()`
  short-circuits on the sign-out flag), and Anonymous is **not** granted administration
  access. `apps/nuxeo-ui-e2e/src/auth.spec.ts` carries both.

  Product implication worth carrying into Beta: a customer who deploys with anonymous auth
  enabled gets an app that signs unauthenticated visitors in as `Anonymous`. That is the
  server's decision and the client reflects it faithfully, but it is not obvious from the
  UI, so the privilege boundary is the thing to test rather than the sign-in boundary.

- **The `test` gate does not typecheck.** Vitest transpiles through esbuild, so two
  real type errors in Phase 2 code passed 46 green unit tests and were caught only
  by `build`. Never treat a green `test` gate as evidence that types are sound.
- The marketplace installer copies the web directory with `overwrite="true"`, so
  **configuration inside the bundle is destroyed on upgrade**.
- The POC's bridge tokens (`DOCUMENT_API_TOKEN`, `QUERY_API_TOKEN`,
  `ROOT_DOCUMENT`, `DEFAULT_REPOSITORY_ID`) are local clones of published
  exports. Migration is to import upstream's and delete the clones.
- **Adopting `HxpDocumentListComponent` is API-port work, not a component swap, and
  the chain is now measured rather than estimated.** Attempting the swap on this
  branch compiles and typechecks, then fails at runtime with
  `NG0201: No provider found for DocumentService. Path: DocumentCacheService ->
DocumentService`. The chain, read from the published bundle:
  - the component does `inject(DocumentCacheService)` and
    `inject(ContextMenuActionsService)`, both **non-optionally**, so neither can be
    avoided — including by setting `[contextMenuActions]="false"`, which only
    changes rendering;
  - `DocumentCacheService` is `providedIn: 'root'` but injects upstream's
    `DocumentService`, which is **not** `providedIn` anything and must be provided;
  - `DocumentService`'s constructor requires three tokens — `DOCUMENT_API_TOKEN`,
    `QUERY_API_TOKEN` and `VERSION_API_TOKEN`, none optional — plus copy, move,
    create-version and restore-version services;
  - `ContextMenuActionsService` is also not `providedIn` anything and takes ten
    action handlers; `CONTEXT_MENU_ACTIONS_PROVIDERS` supplies nine of them.

  `ADF_HX_NUXEO_BRIDGE_PROVIDERS` binds `NuxeoDocumentApi` and `NuxeoQueryApi` to the
  bridge's **clone** tokens, so upstream's `DocumentService` cannot see them.
  **`VERSION_API_TOKEN` has no implementation at all** — manage-versions is a
  capability the POC lacks — so no amount of rebinding makes the swap work. Implement
  and bind the three ports first; the component swap is the small part that follows.

- **The two document lists are not interchangeable.** The hand-written
  `hxp-document-list` is 384 lines and renders an error state with retry, a card view,
  thumbnails and its own column picker. Upstream's renders a DataTable and nothing
  else: its inputs are `documents`, `isLoading`, `multiselect`, `contextMenuActions`
  and `schema`, and it emits `selectedDocuments`, `rowClicked`, `sortingClicked` and
  `columnsResized`. Those four capabilities must be rehomed to the host page, not
  dropped. `PACKAGED_BROWSE_COLUMNS` maps cleanly onto upstream's `[schema]` as
  `DataColumn[]`, so Layer 1 can drive the real DataTable without a second column list.
- **The published packages are compiled against Angular 19.2.18**, per the
  `ɵɵngDeclareFactory` metadata, while this repo runs 20.3.31. It compiles and builds;
  treat any partial-compilation oddity as a candidate cause before blaming our code.
- **The full provider chain for `HxpDocumentListComponent` is six API ports, not three,
  and it was walked to the end.** `DOCUMENT`, `QUERY` and `VERSION` are
  `DocumentService`'s own constructor tokens. Then `COPY` and `MOVE` arrive through its
  `SingleItemCopyService` and `SingleItemMoveService`, `CHECKIN` through its
  `CreateDocumentVersionService`, and `DOWNLOAD` through the context-menu handlers'
  `FileDownloadService -> SingleFileDownloadService -> BlobDownloadService`. Every link
  is non-optional. `[contextMenuActions]="false"` does **not** avoid the handler chain —
  `ContextMenuActionsService` constructs its handlers eagerly and that input only
  controls rendering. All six are thin over existing `nuxeo-client` methods:
  `VersionApi` declares one method, `CopyApi` and `MoveApi` one each, and
  `DocumentDetailService` already had `restoreVersion`, `fetchBlobByXpath`,
  `copyDocuments` and `moveDocuments`. Only `CHECKIN` needed a new service method.
- **`providedIn: 'root'` upstream decides where our providers must live.**
  `DocumentCacheService` is root-provided, so it resolves `DocumentService` from the
  root injector and cannot see component providers — providing `DocumentService` on the
  POC component leaves `NG0201` unchanged. Providing `DocumentCacheService` **itself**
  on the component shadows the root default and the whole chain then resolves locally.
  Prefer that to registering in `app.config.ts`, which also works and costs the initial
  bundle dearly (see below).
- **adf-core's `TranslationService` does not use the ngx-translate loader interface.**
  It takes `translate.currentLoader` and calls `setDefaultLang`, `providerRegistered`,
  `registerProvider`, `getFullTranslationJSON` and `init` — none of them part of
  `TranslateLoader`. With a plain loader in place every adf-hx component dies with
  `TypeError: this.customLoader.setDefaultLang is not a function`. Do **not** replace
  `AppTranslateLoader` with adf-core's `TranslateLoaderService`: that deletes the
  manifest-`labels` layering, which is a shipped Layer 0 capability. Extend it instead
  and override `getTranslation`. Note the base declares a **private** `http`, so a
  subclass field of that name fails `TS2415`/`TS4114`. adf-core also fetches
  `assets/adf-core/i18n/<lang>.json`, which has to be added to the build's asset globs.
  _Changed by NXSAT-636 (2026-10):_ with adf-core's wiring removed, `AppTranslateLoader` is a
  plain `TranslateLoader` again and the adf-core asset glob is gone (W2 in
  `docs/adf-hx-workarounds.md`).
- **`nuxeo-ui` has no `typecheck` target, so the `typecheck` gate does not cover the
  app.** Two real `TS` errors in `app.config.ts`-adjacent app code passed
  `nx affected -t typecheck` and were caught only by `build`. This is the same trap as
  the `test` gate, one layer over.
- **Decisions taken, do not re-open without new information:**
  - **`ng-mocks` stays stubbed, indefinitely.** Upstream will not be changing the shipped
    `/ui` bundle, so `tools/stubs/ng-mocks/` is the resolution rather than a workaround
    awaiting one. It must survive every adf-hx bump; the `bundle` gate goes red if the
    real library returns, and a future release importing a _different_ test helper shows
    up as a new fingerprint rather than as a silent regression.
    _Changed by NXSAT-672 (2026-10):_ the new information is that adf-hx is gone (NXSAT-637,
    held out by the blocking `dependency-tree` gate), so nothing imports `ng-mocks` and the stub
    stood in for nothing. It was removed; the `bundle` gate stays and still fails on the real
    library's fingerprints.
  - **`angular-oauth2-oidc` is kept**, unused, on the basis that it causes no issue
    today — `pdfjs-dist` tree-shakes out entirely, this does not. Not a blocker; revisit
    only if something breaks or the SCA position changes. `cropperjs` was kept on the same
    basis until NXSAT-290, which made it used: its stylesheet is a global style, because
    adf-core's image viewer renders every image twice without it.
    _Changed by NXSAT-672 (2026-10):_ all three were removed. adf-core and its image viewer
    left in NXSAT-637, so `cropperjs`'s global stylesheet styled nothing (no `cropper-` class in
    any template or style), and no source imports `angular-oauth2-oidc` or `pdfjs-dist`.
  - **The initial-bundle cost of adf-hx is accepted.** It stopped being a deferrable
    question the moment the ports had to go in the root injector, so the budget was
    raised deliberately: `maximumWarning` 1.5 → 2.5 MB, `maximumError` 2.0 → 3.5 MB.
    **Leadership has not been told yet and should be** — the numbers for that
    conversation:

    |                     | Initial bundle                          |
    | ------------------- | --------------------------------------- |
    | before adf-hx       | 1.70 MB                                 |
    | with adf-hx adopted | **3.00 MB**                             |
    | increase            | **+1.30 MB, once, then browser-cached** |

    It is unavoidable rather than a choice. Eleven upstream services are
    `providedIn: 'root'` and resolve the API-port tokens from the root injector, so the
    ports cannot be scoped to the lazily-loaded POC route — providing them on the
    component means shadowing all eleven locally, and that list grows with every
    component adopted. Loading adf-core on demand was tried and fails one `NG0201` at a
    time.

    Practical effect: unnoticeable on an office network, roughly a second or two on the
    first page load over a slow link. The alternatives, if the figure is ever refused,
    are trimming existing weight out of the startup bundle (real work, uncertain payoff)
    or not adopting adf-hx at all, which abandons the premise of the Beta.

    _Changed by NXSAT-638 (2026-10):_ with adf-hx removed, the uncached production initial
    bundle measured 2.96 MB, down from 4.07 MB on integration (PR #418). `maximumError` is back
    at 4 MB; `maximumWarning` stays at 2.5 MB, which the build still exceeds.
- **~~THE CURRENT PHASE 3 BLOCKER~~ RESOLVED — kept because the measurements are the fact.**
  A bundle-boundary problem, not a port problem, closed by the secondary entry point
  `@agentic-ui/shared/adf-hx-bridge/providers`.
  `apps/nuxeo-ui/src/app/shell/app-shell.component.ts` and `nav-drawer.component.ts`
  both import `@agentic-ui/shared/adf-hx-bridge`, whose single barrel re-exports
  `provide-adf-hx-nuxeo-bridge.ts`. The moment that file imports anything from
  `@alfresco/adf-hx-content-services`, adf-hx and its dependencies become reachable from
  the shell and land in the **initial** bundle. Measured: initial goes 1.70 MB → 2.65 MB
  with the ports rebound and the POC untouched, and → 2.86 MB with the swap, against a
  2.00 MB `maximumError`. Removing the ports from the barrel's exports does not help —
  the providers file still imports them. **Rebinding to upstream tokens at all requires
  a secondary entry point in the bridge library, or the shell must stop importing the
  bridge barrel.** The entry point was built and the initial bundle returned to 1.71 MB with
  the ports bound; it is now 3.24 MB for a different and accepted reason — see the
  root-injector fact above. **Do not add new eager imports from `providers.ts`.** The lazy POC
  route remains the intended consumer for most of this surface; two product decisions already
  pull adf-hx into the initial bundle on purpose — `provideAdfHxNuxeoBridge()` in
  `app.config.ts` and `HxpBrowseNavDrawerComponent` in the shell nav drawer (see the guardrail
  allowlist in `scripts/review-guardrails.mjs`).
  _Changed by NXSAT-635 (2026-10):_ the bridge, its `providers` entry point and the POC routes
  are removed, so nothing in the shell imports adf-hx and none of this applies.
- **Configuration is contributed by Marketplace packages and served by a servlet; the package
  installs no configuration file (NXSAT-312).** The `nuxeo-agentic-core` bundle declares
  `org.nuxeo.agentic.ui.config` with the extension point `configuration`
  (`<fragment name layer="bootstrap|manifest">`, `<layout type mode>`, `<asset name>`; `src` read
  from the contributing bundle, or an inline `<json>`) and contributes our defaults as
  `org.nuxeo.agentic.ui.config.defaults`. `AgenticUiConfigServlet`, mapped at
  `/agentic-ui-config/*` by the deployment fragment's `web#SERVLET` and `web#SERVLET-MAPPING`,
  serves the ordered fragments with provenance, an ETag fixed per snapshot and
  `Cache-Control: no-cache`. A customer package depends on `nuxeo-agentic-ui` in `package.xml`
  and `<require>`s our defaults component. Rehearsed on a throwaway 2025.26.16 on 2026-10-07:
  fresh install; a customer package installed and removed (back to our defaults byte for byte);
  two customer packages, where the resolver refuses the dependent alone and installs both in
  dependency order however they are named; and an upgrade of **our** package with both installed,
  which `nuxeoctl` performs as uninstall dependents → upgrade ours → reinstall dependents, with
  their configuration served unchanged (`evidence/feedback-response/NXSAT-312/rehearsal/`,
  local). **A configuration package on a server whose `nuxeo-agentic-ui` predates NXSAT-312
  stops Nuxeo from starting**: strict mode aborts on the unresolved `<require>`. The servlet path
  is more specific than Tomcat's default servlet, so nothing on disk under
  `nxserver/nuxeo.war/agentic-ui-config` is served, and `checkInstallerOwnsNoCustomerFile` fails
  on any copy there. The old `bootstrap.json`-beside-the-bundle mechanism is **removed with no
  migration**. `overwrite="false"` stays forbidden everywhere: rehearsed in NXSAT-317, an upgrade
  after an edit to a file it protected left no version installed. **The web destination must be
  under `nxserver/nuxeo.war`** — the Tomcat docBase for the `/nuxeo` context; `nxserver/web` is
  not a docBase. Everything served at `/nuxeo/agentic-ui-config/` is **anonymous**. Not
  rehearsed: the Admin Center / Update Center path, which runs the same package tasks.
- **Configuration is loaded, not compiled.** `libs/shared/app-config` fetches
  `agentic-ui-config/bootstrap.json` and `manifest.json` together, pre-auth,
  from the configuration servlet, and folds their ordered fragments over the
  packaged defaults. Eleven `InjectionToken` factories resolve from it. Both
  loads are tolerant: a 404, an unreachable server or a response that is not
  the `nuxeo-agentic-ui-config/1` envelope falls back to the packaged defaults,
  and the packaged defaults reproduce the pre-Phase-1 compiled values exactly.
  _Changed by NXSAT-312 (2026-10):_ until then the manifest was a Nuxeo Note at
  `/default-domain/config/agentic-ui`, read post-auth; nothing reads it now, and
  nothing is re-fetched on sign-in.
- **Angular's hash routing hides configuration reloads from evidence captures.**
  `withHashLocation()` makes route changes same-document, so `page.goto('/#/x')`
  does not re-run `APP_INITIALIZER`. Any capture that changes configuration must
  force a full reload, and route interception must send `Cache-Control: no-store`
  or the browser answers from cache and the interception is never seen.
- **Angular's build configurations REPLACE `assets`; they do not merge it.** Only
  `architect.build.options.assets` carried adf-core's translation glob, so **every dev server
  ever started on this branch 404ed `/assets/adf-core/i18n/en.json`** while the production
  build shipped it correctly. This was diagnosed for a full session as a stale dev server
  needing a restart, which could never have helped. A `guardrails` check now fails when any
  configuration overrides `assets` and omits a base entry. **If a dev server 404s an asset the
  production build ships, check the `development` array before anything else.**
- **adf-hx's own i18n catalogues will not load themselves.** adf-hx components _do_ register
  them — `provideTranslations('adf-enterprise-adf-hx-content-services-ui', …)` sits in each
  component's own `providers` — but registration happens at **component construction**, long
  after the language has loaded, and `AppTranslateLoader.init` is a no-op by design. So the
  registration lands and the strings never arrive: the versions panel rendered
  `MANAGE_VERSIONS.DIALOG.TITLE` as its heading. Both adf-hx catalogues are now **seeded**
  alongside adf-core's in `SEEDED_FOLDERS`, and the `bundle` gate asserts all three ship.
  **Adopting a new adf-hx component means checking its keys resolve, not just that it renders.**
  _Changed by NXSAT-636 (2026-10):_ the seeding is removed (W6); the loader's `UPSTREAM_FOLDERS`
  holds satori-ui's catalogue alone.
  _Changed by NXSAT-638 and NXSAT-697 (2026-10):_ the `bundle` gate asserts none of the three
  catalogues; with adf-hx removed, none ships. Its `REQUIRED_FILES` are the two catalogues
  `AppTranslateLoader` fetches at runtime, the app's `i18n/en.json` and satori-ui's
  `assets/satori-ui/i18n/en.json`, each checked by a key the app renders (PR #419).
- **`AsyncPipe` must be provided for any adf-hx component that renders a user.**
  `UserResolverPipe` calls `inject(AsyncPipe)` in its constructor and `AsyncPipe` carries no
  `providedIn`. Missing, it throws `NG0201` **while rendering** — the component's shell appears
  and its content does not, which reads as an empty panel rather than an injector error. It is
  in `ADF_HX_NUXEO_BRIDGE_PROVIDERS`.
- **Upstream renders every user as `` `${firstName} ${lastName}` `` with no guard.**
  `UserResolverService.getFullName` is exactly that. Nuxeo's own `Administrator` has both
  properties set to the **empty string**, and a `User` built from a bare username has both
  **unset** — which rendered the literal `undefined undefined`. Both mappers now put the
  username in `firstName` and leave `lastName` empty. **Never hand upstream a `User` with an
  unset `firstName`.**
- **`UserService.resolveUser` caches per id.** Given a username _string_, upstream resolves it
  through the `USER` port once and caches the observable for the app's lifetime. That makes a
  display-name lookup far cheaper than the earlier assessment of "a `/user/{id}` call per
  distinct contributor on every page" implied, and it is the live path in the versions panel.
- **Nuxeo sends no `versionLabel`.** Its REST payload carries `uid:major_version` and
  `uid:minor_version` as separate integers and no composed label, so `sysver_title` must be
  built. And **a version's `parentRef` is the live document's _folder_, not the live document** —
  the live document id is `versionableId`, which is what `sys_parentId` must carry, because
  `DocumentVersionsService.getCurrentDocument` follows it.
- **`/search/lang/NXQL/execute` is OpenSearch-backed here and lags.** Measured: immediately
  after two `Document.CheckIn` calls the NXQL query for a document's versions returned **one**
  of the two, and both only once the index caught up. `Document.GetVersions` reads the
  repository directly and returned both immediately. **Anything that must reflect a write it
  just made cannot go through the search endpoint.**
- **`Document.GetVersions` answers oldest-first**, and adf-hx's HXQL asks for
  `ORDER BY sysver_created DESC`. The ordering is applied in the `QUERY` port; a port that
  returned Nuxeo's order would look correct on any single-version document.
- **`@versions` is not a registered adapter on this Nuxeo distribution.**
  `GET /id/{uid}/@versions` answers `404 Service versions not found for object`. Use the
  `Document.GetVersions` operation instead.
- **The Nuxeo content model needs THREE reads, and `/config/types` alone is a trap.**
  `/config/types` gives doctypes (`parent`, `facets`, `schemas`) and a **flat** schema map
  covering only the schemas a doctype reaches — 48 of 98 on the local instance. `/config/facets`
  is the only way to learn what a facet contributes, because a doctype lists its facets by name.
  `/config/schemas` is the nested superset. Reading schemas from `/config/types` silently omits
  fifty of them.
- **adf-hx's `FieldType` values ARE Nuxeo's field type strings** —
  `boolean | blob | complex | date | double | long | object | string`, each with a `[]` variant.
  And `DocumentModel.resolveType` returns any type it does not recognise unchanged. So
  `Model.types` is left **empty** on purpose: there is nothing in Nuxeo to populate it from, and
  populating it could only _change_ types that are already right.
- **HxPR keys a schema's fields by their PREFIXED name; sub-fields stay unprefixed.**
  `{ prefix: 'dc', fields: { dc_title: … } }`. `getSchemaByPrefix('dc_title')` splits on `_`,
  takes `dc`, then requires `Object.keys(fields)` to contain the **whole** `dc_title`. Keyed by
  the bare `title` it matches nothing and **every field silently becomes `FieldType.String`** —
  dates rendering as raw ISO strings, which looks like a formatting bug. But
  `getComplexFieldDetails` and the dotted-path branch of `getFieldDefinition` look sub-fields up
  by their **bare** name, so prefixing those breaks what prefixing the top level fixes.
- **A Nuxeo `@prefix` of `''` means "use the schema name", not "no prefix".** `file`, `uid` and
  `files` all report empty, and Nuxeo then addresses them as `file:content` and
  `uid:major_version`. Read literally the keys become `_content` and `_major_version`.
- **`sys_primaryType` is the key into `Model.primaryTypes`, so it must carry the NUXEO doctype
  name.** It was a synthetic `SysFolder`/`SysFile` for most of Phase 3, and that broke four things
  for one reason: the `MODEL` port keys the registry by Nuxeo doctype, because that is the only
  registry Nuxeo has. Visible — the properties panel's **Category select rendered empty**. Latent —
  `extractCustomSchemaFields(sys_primaryType)` finds no custom schema fields; `getSubtypes` falls
  back to all sixty types; and the document-category search filter emits
  `sys_primaryType IN ('…')` as HXQL against a type name Nuxeo has never heard of.
  **`isRoot()` is the only place upstream compares this to a `Sys*` literal**, so `SysRoot`
  survives for the synthetic repository root and nothing else needs a synthetic value.
  **Do not classify with `sys_primaryType`** — folderishness is `sys_isFolderish` and
  `sys_mixinTypes`.
- **The folder header renders `sys_typeLabel ?? sys_primaryType`.** With the synthetic root
  unlabelled the POC's landing screen read "Repository / **SysRoot**". Any `Sys*` value that can
  reach a label needs a `sys_typeLabel` beside it.
- **Nuxeo answers an unsupported `sortBy` with HTTP 200 and ZERO entries.** Not an error —
  measured with `sortBy=ecm:isFolder` on `@children`. So a sort key must be validated _before_ the
  request: forwarding one renders an empty folder, which reads as missing data. `NuxeoQueryApi`
  refuses by name and lists the sortable keys.
- **"Folders first" cannot be expressed as a Nuxeo sort.** There is no sortable folderish property,
  so `sys_isFolderish` has no mapping and the default order dropped it. Nothing regressed: the sort
  was being **discarded entirely** by the port, so folders-first was never actually applied.
- **Nuxeo counts only within `resultsCountLimit`, which it sets to the requested `pageSize`.** So
  `resultsCount` is a real total **exactly when the result set fits on one page**, and `-2`
  otherwise — measured, `pageSize=39` over 39 children answered `39` while `pageSize=20` answered
  `-2`. **The total is known only when there is nothing to page**, which is why a numbered pager is
  impossible and `isNextPageAvailable` is the fact to build on.
- **adf-core's DataTable sorts the loaded page client-side, independently of any server sort.** So a
  reordered list does **not** prove the server was asked to order — that is what made the dropped
  sort look fixed for several phases. Assert on the request, not on the row order.
- **The eager bundle has TWO causes.** `CONTEXT_MENU_ACTIONS_PROVIDERS` in `app.config.ts`, **and**
  the app shell's nav drawer rendering upstream's `HxpDocumentTreeComponent`. The second is a product
  decision, so adf-hx is eagerly needed by the shell by design. It is the one documented exception in
  the API-surface gate.
- **Nuxeo has no `sys` schema, so the bridge supplies one.** Upstream's
  `DocumentPropertiesService` lists properties from `Object.keys(document)` and its
  `TOP_DEFAULT_PROPERTIES` are all `sys_*`, so a faithfully translated Nuxeo model types **none**
  of them: `Created` rendered `2026-08-22T14:23:05.687Z` and `Creator` rendered
  **`[object Object]`**. The `MODEL` mapper now adds a `sys` pseudo-schema describing the fields
  _our own document mapper emits_ — declaring our output, not guessing at Nuxeo's. **If the two
  drift apart the panel mistypes a field**, which is why one spec asserts the pair together.
- **A document carries TWO property surfaces, and upstream's design is what stops them
  duplicating.** `sys_*` fills the properties panel's _main_ section; Nuxeo's own properties as
  `prefix_field` fill the _other_ section, because upstream excludes `sys_`, `sysfile_blob`,
  `sysver_` and `sysgov_` from it. Do not "clean this up" by removing one.
- **`SysFilish` on a type must come from the `file` schema, not from "is not `Folderish`".**
  `hasMixin` walks `extends`; `Folder extends Document`; `Document` is not `Folderish`. The
  fallback marked `Document` filish and **every folder inherited it**.
- **Look for an exported provider array before chasing `NG0201` one at a time.** `AsyncPipe`,
  `UserResolverPipe`, `DOCUMENT_PROPERTIES_SERVICE` and `DOCUMENT_SERVICE` were each added in
  response to a separate injector error before `DOCUMENT_PROVIDERS` and `USER_RESOLVER_PROVIDERS`
  turned up, already exported, in `provideAdfEnterpriseAdfHxContentServicesServices()`. Note the
  gap that function still leaves: it provides adf-hx's pipes and **not adf-core's**, so
  `PropertyUtilService` cannot construct without `DecimalNumberPipe`, `LocalizedDatePipe` and
  `FileSizePipe` as well.
- **adf-core renders property values inside `<input>` elements, so `innerText` does not contain
  them.** Two evidence assertions passed while the screenshot showed a raw ISO timestamp and
  `[object Object]`. **A negative assertion over text that cannot contain the value is not an
  assertion** — read `input.value` too.
- **~~Nuxeo has no `sys` schema, and that is the metadata-sidebar problem.~~ Resolved above.** Upstream's
  `DocumentPropertiesService` lists properties from `Object.keys(document)`; our mapper emits
  `sys_*`. A faithfully translated Nuxeo model therefore types **none** of them. Making the
  metadata sidebar work is a decision about the document's property surface, not a mapping fix.
- **adf-hx writes `SysFilish`, with no `e`** — in `isFile()`, `getFilishTypes()` and two mixin
  checks. Our mapper emitted `SysFileish`, so `isFile()` was always false for every non-folder
  document we produce.
- **`adf-hx-bridge` can be unit-tested against real upstream services, but only with two vitest
  settings.** adf-core's fesm bundle does a _directory_ import of `date-fns/locale`, which Node's
  ESM resolver rejects; Vitest externalises `node_modules`, so `resolve.alias` never sees the
  specifier. An alias **plus** `server.deps.inline` for `@alfresco/*` and `date-fns` is what
  makes it work. The Angular bundler tolerates the directory import, which is why the
  application builds and only tests were affected. Worth the setup: the field-key discovery above
  came from a `DocumentModelService` integration test, not from reading the bundle.
- **`DocumentModelService` calls `modelApi.getModel()` eagerly from its constructor — but a
  refusing port does NOT stop it constructing.** It is `providedIn: 'root'` and injects
  `MODEL_API_TOKEN`. The eager call is real; the obvious conclusion from it is wrong. Our
  refusing `getModel` is `async`, so its `throw` becomes a **rejected promise**, and
  `from(promise)` does not touch it until something subscribes. Verified in
  `nuxeo-unmapped-api.spec.ts` — which exists because the opposite was asserted in three files
  first, on reasoning alone. Two real consequences:
  - an **unhandled promise rejection reaches the console at injection time**, before any user
    action, because the constructor makes a rejected promise nobody is subscribed to. It will
    trip `expectNoConsoleErrors` the moment metadata-sidebar or properties-viewer is adopted,
    and only a read-side `MODEL` removes it;
  - the failure lands **where the model is read**, so the component renders and its property
    fields fail — which is the behaviour a refusing port is _meant_ to have, and why these two
    ports are bound rather than left unbound.
    **This is the general shape of every refusing port: bound, constructs, fails at the point of
    use. Do not describe one as a construction-time blocker without testing it.**

---

## 4. Phases and their gates

Each phase is complete only when **all three** of its gates pass. Partial
completion is not completion; see section 6.

| Phase              | Deliverable                                                                      | Evidence steps file          |
| ------------------ | -------------------------------------------------------------------------------- | ---------------------------- |
| `phase-0-baseline` | Dependencies install, gates run, CI validates the branch                         | `steps/phase-0-baseline.mjs` |
| `phase-1-config`   | Runtime configuration held outside the installed app tree, runtime theming, i18n | `steps/phase-1-config.mjs`   |
| `phase-2-registry` | Extension registry, rules, nav and routes from manifest, action registry         | `steps/phase-2-registry.mjs` |
| `phase-3-adf-hx`   | ~10 of 12 Nuxeo-backed API ports, component swap, encapsulation gate             | to be added                  |
| `phase-4-platform` | Publishable libraries, public API, semver, template and starter                  | to be added                  |
| `phase-5-harness`  | Customer knowledge base, generators, runnable guardrails                         | to be added                  |
| `phase-6-quality`  | Coverage, E2E, accessibility, security scans, upgrade rehearsal                  | to be added                  |

### The gates

1. **Quality gate** — `npm run beta:gate -- --phase <id>` is green with
   `verdict: "pass"`, **not** `pass-partial` or `pass-incomplete` (node, lockfile, guardrails,
   assertions, affected lint, test, build, typecheck).
2. **Evidence gate** — `npm run beta:evidence -- <id>` exits 0, meaning every
   step recorded at least one check and every check passed. Exit 2 is
   `precondition-not-met`: fix the environment, do not iterate.
3. **Independent validation** — the evidence auditor and acceptance validator in
   `AGENTS/12-review-agents.md` have both run, neither on its own author's work.
   `npm run beta:audit` and `npm run beta:state` are their mechanical half.
4. **Review gate** — the phase's `INDEX.md` is attached to the PR, and a
   multi-model adversarial review has run over the diff.

Gate 3 is new because gates 1, 2 and 4 all passed on Phase 1 while its config path
would have 404'd on every install. It is the only gate that has ever caught that
class of defect here, and it has **never been run** for Phase 1 or Phase 2.

---

## 5. Agent roster

Cursor's subagent types are fixed, so this roster is a convention the skills
apply rather than a config file. Use the `Task` tool with the stated type and
model.

| Role           | Subagent type         | Model                                     | Used for                                                               |
| -------------- | --------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| Architect      | `generalPurpose`      | Claude Opus 5 thinking / GPT-5.6          | Public API design, action registry shape, extension contract decisions |
| Implementer    | inherit (main thread) | Claude Sonnet 5 thinking                  | API ports, component swaps, feature work                               |
| Explorer       | `explore`             | inherit                                   | Locating code, mapping call sites before a change                      |
| Test author    | `generalPurpose`      | Composer 2.5 Fast / Gemini 3.7 Flash      | Spec scaffolding, i18n extraction, codemods                            |
| Reviewer panel | `generalPurpose` x2-3 | Opus 5 **and** GPT-5.6 **and** Gemini 3.7 | Adversarial review; different families surface different defects       |
| Bug hunter     | `bugbot`              | inherit                                   | Pre-PR review of branch changes                                        |
| Security       | `security-review`     | inherit                                   | Any change touching auth, blobs or config loading                      |

**Rule on reviews:** never accept a single model's verdict on its own output.
Agreement across two families is the signal; disagreement means a human looks.

---

## 6. Iteration protocol

Agents consistently declare victory early. This protocol exists to prevent that.

1. Make the smallest change that could satisfy the step.
2. Run the **fast inner loop**: `npm run beta:gate -- --gates guardrails,lint`.
3. Fix the single first reported failure. Do not batch speculative fixes.
4. Repeat 2-3 until green, then run the **full gate**.
5. Run the evidence capture for the phase.
6. If either gate fails, return to step 3. **Maximum three attempts per step**;
   after the third, stop and report what is blocking rather than continuing to
   churn.
7. Only when both gates pass may the step be marked complete.

Stop conditions that require a human, not another attempt:

- The same failure recurs after three distinct fix attempts.
- A fix requires changing a verified fact in section 3.
- A fix requires widening the public API or touching `install.xml` packaging.
- A test would have to be weakened or skipped to pass.

**Never** mark a step complete on the basis of reasoning alone. The gate output
and the evidence manifest are the only acceptable proof.

---

## 7. Non-negotiables for Beta code

Beyond the standing rules in `AGENTS.md`:

- **adf-hx types never appear in our public API signatures.** Their instability must not
  become the customer's. Nothing imports adf-hx since the ADF removal (PR #418); the blocking
  `dependency-tree` gate fails on any of the five ADF packages in the lockfile, the installed
  tree, a manifest, `.npmrc` or an import. `libs/shared/adf-hx-bridge`, which wrapped them, was
  removed by NXSAT-635.
- ~~**Pin exact adf-hx versions**, never a range or dist-tag.~~ adf-hx is removed (NXSAT-637).
- **Anything a customer might want to change goes through Layer 0 or 1.** No new
  hardcoded action lists, nav entries, or theme values.
- **No configuration inside the packaged web directory.** It will be destroyed on
  upgrade.
- **Every new service method gets a unit test including its error path.**
- **Credentials from the environment only**, per `AGENTS/07-security.md`.

---

## 8. Where things live

| Artifact                | Location                                                    |
| ----------------------- | ----------------------------------------------------------- |
| Phase evidence runner   | `scripts/beta-harness/phase-runner.mjs`                     |
| Verification gate       | `scripts/beta-harness/verify-gate.mjs`                      |
| Node runtime preflight  | `scripts/beta-harness/node-version.mjs`                     |
| Lockfile integrity gate | `scripts/beta-harness/lockfile-integrity.mjs`               |
| Dependency-tree gate    | `scripts/beta-harness/dependency-tree.mjs` (blocking)       |
| Assertion audit         | `scripts/beta-harness/assertion-audit.mjs`                  |
| Coverage ratchet        | `scripts/beta-harness/coverage-gate.mjs`                    |
| Phase state check       | `scripts/beta-harness/state-check.mjs`                      |
| Backend preflight       | `scripts/beta-harness/backend-preflight.mjs`                |
| Machine-readable state  | `.ai/state/phases.json`, `.ai/state/coverage-baseline.json` |
| Review role spec        | `AGENTS/12-review-agents.md`                                |
| Review adapters         | `.cursor/skills/audit-evidence/`, `.claude/agents/`         |
| Phase steps files       | `scripts/beta-harness/steps/<phase-id>.mjs`                 |
| Evidence output         | `$AGENTIC_UI_EVIDENCE_DIR/beta/<phase-id>/<timestamp>/`     |
| Gate reports            | `$AGENTIC_UI_EVIDENCE_DIR/beta/gates/`                      |
| `nxs-` components       | `libs/shared/satori-components/`                            |
| Retired-route redirects | `apps/nuxeo-ui/src/app/retired-routes.ts`                   |
| Action plan             | `docs/adf-hx-poc-action-plan.md`                            |
| Extension reference     | `docs/extension-reference.md`                               |
| Extension registry      | `libs/shared/extensions/`                                   |
| Orchestrating skill     | `.cursor/skills/beta-phase/SKILL.md`                        |
