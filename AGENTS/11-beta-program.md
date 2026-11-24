# Beta Program — Nuxeo Satori Component Platform

Context every agent needs before doing Beta work. Read this **after** `AGENTS.md`
and alongside `AGENTS/00-architecture.md`.

**RFC:** "RFC: Nuxeo Satori Beta - Component Platform and Customer Extensibility Model"
**Tickets:** NXENG-619 (Discovery) under NXENG-615 (Epic)
**Harness:** `scripts/beta-harness/` · **Entry skill:** `beta-phase`

---

## 1. What we are building, in one paragraph

A deep core ECM slice — browse, folder tree, search, document detail, metadata,
permissions, versions, upload and CRUD — built on our own `nxs-` components and
made customisable through a four-layer extensibility contract. Workflow, users
and groups, administration and publishing are **out of scope for Beta**.

The components live in `libs/shared/satori-components`.

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

- **CI runs on this branch and passes.** `ci.yml` triggers on `push` as well as on
  `pull_request`, so a long-lived feature branch is validated without a PR. Run
  32480243192 is `completed success` on Node 20. Two phase reviews disagreed about
  this — one claimed "CI has still never run against it" — and the claim that it had
  run was the correct one. No pull request has been opened, so only the PR-triggered
  path is unexercised.
- **`SATORI_GH_READONLY_TOKEN` is set as a repository secret**, since 2026-08-03,
  and `read:packages` resolves `@hylandsoftware`. The plan's
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
  gh run list --branch <your-branch> --limit 3 \
    --json status,conclusion,headSha,event
  ```

  Note that `concurrency.cancel-in-progress` is on, so pushing again **cancels** the
  previous run. A `cancelled` conclusion on an earlier commit is expected, not a failure —
  but it also means only the newest run has actually verified anything.

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
  `documentEdit` and `documentCreate` — the last read by the create form in the Create /
  Import dialog, which NXSAT-630 moved onto it. The earlier "`routes`,
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
- **The published packages are compiled against Angular 19.2.18**, per the
  `ɵɵngDeclareFactory` metadata, while this repo runs 20.3.31. It compiles and builds;
  treat any partial-compilation oddity as a candidate cause before blaming our code.
- **`nuxeo-ui` has no `typecheck` target, so the `typecheck` gate does not cover the
  app.** Two real `TS` errors in `app.config.ts`-adjacent app code passed
  `nx affected -t typecheck` and were caught only by `build`. This is the same trap as
  the `test` gate, one layer over.
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
  `architect.build.options.assets` carried a translation asset glob, so **every dev server
  ever started on this branch 404ed that catalogue** while the production
  build shipped it correctly. This was diagnosed for a full session as a stale dev server
  needing a restart, which could never have helped. A `guardrails` check now fails when any
  configuration overrides `assets` and omits a base entry. **If a dev server 404s an asset the
  production build ships, check the `development` array before anything else.**
- **`/search/lang/NXQL/execute` is OpenSearch-backed here and lags.** Measured: immediately
  after two `Document.CheckIn` calls the NXQL query for a document's versions returned **one**
  of the two, and both only once the index caught up. `Document.GetVersions` reads the
  repository directly and returned both immediately. **Anything that must reflect a write it
  just made cannot go through the search endpoint.**
- **`@versions` is not a registered adapter on this Nuxeo distribution.**
  `GET /id/{uid}/@versions` answers `404 Service versions not found for object`. Use the
  `Document.GetVersions` operation instead.
- **The Nuxeo content model needs THREE reads, and `/config/types` alone is a trap.**
  `/config/types` gives doctypes (`parent`, `facets`, `schemas`) and a **flat** schema map
  covering only the schemas a doctype reaches — 48 of 98 on the local instance. `/config/facets`
  is the only way to learn what a facet contributes, because a doctype lists its facets by name.
  `/config/schemas` is the nested superset. Reading schemas from `/config/types` silently omits
  fifty of them.
- **A Nuxeo `@prefix` of `''` means "use the schema name", not "no prefix".** `file`, `uid` and
  `files` all report empty, and Nuxeo then addresses them as `file:content` and
  `uid:major_version`. Read literally the keys become `_content` and `_major_version`.
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

---

## 4. Phases and their gates

Each phase is complete only when **all three** of its gates pass. Partial
completion is not completion; see section 6.

| Phase              | Deliverable                                                                      | Evidence steps file          |
| ------------------ | -------------------------------------------------------------------------------- | ---------------------------- |
| `phase-0-baseline` | Dependencies install, gates run, CI validates the branch                         | `steps/phase-0-baseline.mjs` |
| `phase-1-config`   | Runtime configuration held outside the installed app tree, runtime theming, i18n | `steps/phase-1-config.mjs`   |
| `phase-2-registry` | Extension registry, rules, nav and routes from manifest, action registry         | `steps/phase-2-registry.mjs` |
| Phase 3            | Component adoption, encapsulation gate                                           | to be added                  |
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

- **Anything a customer might want to change goes through Layer 0 or 1.** No new
  hardcoded action lists, nav entries, or theme values.
- **No configuration inside the packaged web directory.** It will be destroyed on
  upgrade.
- **Every new service method gets a unit test including its error path.**
- **Credentials from the environment only**, per `AGENTS/07-security.md`.

---

## 8. Where things live

### Running the harness on Windows

Use the same `npm run beta:gate` command in PowerShell as on macOS/Linux; its base
defaults to `origin/main`. Package-tool subprocesses go through
`scripts/beta-harness/package-command.mjs`, using Node's executable and the tool's
JavaScript entry script without shell interpolation. Use `spawnToolSync`,
`execToolSync` or `spawnTool`; gate descriptors use `tool: 'npm'` or `tool: 'npx'`.
`checkPackageToolLaunches` rejects direct launches, including `cmd: 'npm'` entries.
`.gitattributes` keeps text LF on checkout. The dependency-tree symlink controls need
Windows Developer Mode or administrator privileges; an EPERM there is an environment
failure, not a passing control. `beta:e2e-negative-control` is a Node script too.
The `Cross-platform Beta tooling` workflow exercises arguments on Windows, Linux and
macOS and runs the platform-sensitive gates on Windows, retaining the gate report on failure.
Its PR and push triggers match CodeQL's. Before the full gate, it waits for the
matching CodeQL workflow and an analysis of the exact event ref and revision;
`code-scanning` uses that ref even in a detached Actions checkout. Empty or stale
analysis results never satisfy the wait. Run
`node --test scripts/beta-harness/windows-codeql-wait.selftest.mjs` for its controls.

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
| Plan of record          | `docs/beta-plan.md`                                         |
| Extension reference     | `docs/extension-reference.md`                               |
| Extension registry      | `libs/shared/extensions/`                                   |
| Orchestrating skill     | `.cursor/skills/beta-phase/SKILL.md`                        |

### NEV View preference (NXSAT-698)

`documentView` still has no packaged entry. Deployments select NEV within the packaged viewer
using the `preferARender` rule on `app.tabs.view` in `extensions.slots.tabs`. This preserves
built-in fallback when no NEV URL is available. `app.rules.hasMimeType` enables per-MIME selection;
see `docs/extension-reference.md`. No new extension slot or Layer 2 component is required.
