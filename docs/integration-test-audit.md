# Integration and E2E test audit

**Ticket:** [NXSAT-286](https://hyland.atlassian.net/browse/NXSAT-286) · **Epic:** [NXENG-615](https://hyland.atlassian.net/browse/NXENG-615)
**Branch:** `docs/integration-test-audit`, based on `origin/main` at `0ced6667`
**Executed:** 2026-09-21, macOS, Node v20.20.2 (`.nvmrc`), shared `nuxeo` + `nuxeo-opensearch` containers, dev server on port 4210
**Raw logs and artifacts:** `~/Desktop/agentic-ui-evidence/NXSAT-286/audit/` (outside the repo, per convention)

This document is analysis. It changed no test, no workflow and no application code. The only
file written in the repository is this one.

A note on how to read the numbers below. Several figures in the approved plan and in the
NXSAT-286 ticket description turned out to be stale relative to `origin/main@0ced6667`. Every
count in this document was re-derived first-hand from the tree and from real runs, and
§2.6 lists each correction. Where a claim could not be executed, it says so in the format
§4.6 defines rather than being reported as a pass.

---

## Contents

1. [Executive summary and verdict](#1-executive-summary-and-verdict)
2. [Architecture and test-stack discovery](#2-architecture-and-test-stack-discovery)
3. [Inventory and classification](#3-inventory-and-classification)
4. [Execution results](#4-execution-results)
5. [Failure, skip and blocker classification](#5-failure-skip-and-blocker-classification)
6. [Coverage matrix — feature modules and routes](#6-coverage-matrix--feature-modules-and-routes)
7. [Coverage matrix — services](#7-coverage-matrix--services)
8. [Cross-cutting concern coverage](#8-cross-cutting-concern-coverage)
9. [Test quality assessment](#9-test-quality-assessment)
10. [Quick wins and architectural changes](#10-quick-wins-and-architectural-changes)
11. [Implementation scope — the missing tier in nine stages](#11-implementation-scope--the-missing-tier-in-nine-stages)
12. [CI/CD and quality-gate plan](#12-cicd-and-quality-gate-plan)
13. [Prioritised roadmap](#13-prioritised-roadmap)
14. [Assumptions, limitations and items needing team confirmation](#14-assumptions-limitations-and-items-needing-team-confirmation)
15. [Phase verification record and evidence index](#15-phase-verification-record-and-evidence-index)

Priorities are **P0** (blocks Beta), **P1** (before GA), **P2** (next quarter), **P3** (nice to
have). Effort is **Small** (under a day), **Medium** (one to three days), **Large** (one to two
weeks), **Very Large** (over two weeks). Effort figures are estimates, not measurements, and are
labelled as assumptions in §14.

---

## 1. Executive summary and verdict

### 1.1 Are integration tests sufficient today?

**No.** There is no integration tier at all. The repository has two tiers with nothing between
them:

- **179 in-process specs** (3,016 test cases, all green) in which _every single one_ mocks the
  network. 42 use `HttpTestingController`; the rest mock at the service boundary with `vi.fn()`.
  Not one exercises a real Nuxeo response, a real serialisation boundary or a real error
  payload.
- **19 Playwright cases** against a real browser and a real Nuxeo, covering 3 of 8 named routes
  and performing **zero write operations**.

Between them sits the entire contract surface with Nuxeo — request shapes, response shapes,
error envelopes, enrichers, NXQL generation, upload and download paths — and nothing tests it.

### 1.2 Are the epic's two Definition of Done lines met?

| NXENG-615 DoD line                           | Met?              | Basis                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Integration tests cover key user workflows" | **No**            | No integration tier exists. Of the eleven workflows named in §6.3 — upload, download, delete, restore, permission grant/revoke, version create/restore, collection membership, task completion, note editing, CSV export, logout — **zero** are covered end to end at any tier.               |
| "E2E tests for critical paths"               | **No, partially** | 19 cases exist and are genuine, but they cover 3 of 8 routes; 4 routes have no coverage at all; the suite performs no writes; 2 of 19 cases fail deterministically on WebKit today; and nothing runs it automatically, so it protects nothing between one developer remembering and the next. |

### 1.3 The four most important problems

1. **The E2E suite is red on WebKit on `main` right now, and nobody knows.** `npx nx run
nuxeo-ui-e2e:e2e` exits 1: 36 of 38 runs pass, 2 fail. Both failures are the accessibility
   regression guards for NXENG-750 and NXENG-751, added 2026-09-17 and 2026-09-18 — three weeks
   after WebKit was registered on 2026-08-25 with the claim that the suite passed on it. They
   were written and validated on Chromium only and landed WebKit-red. Deterministic across
   three runs, including Playwright's own retry. This is the clearest possible demonstration of
   the CI gap: the suite runs in no workflow, so a regression in the _accessibility regression
   tests themselves_ reached `main` with every gate green. Details in §5.1.

2. **Several tests certify things they cannot observe.** The suite's own "this is not a pulse
   check" helper is a pulse check. `expectSurfaceWithData(page, 'lib-browse', 'Root')` is used
   at five call sites as the proof that repository data arrived; `'Root'` is a hardcoded
   breadcrumb literal pushed unconditionally at `browse.ts:562`, before any null check, so it
   renders on an empty page, a dead Nuxeo or a 403 on every XHR. Worse, both
   `/#/search?q=…` specs — including the documented HXQL-injection regression guard for
   `hxql-literal.ts` — pass a query parameter the search component never reads: `search.ts:295`
   takes `q` from a service signal written only by the filters drawer, never from the URL. That
   guard is structurally incapable of failing if the security fix is reverted. Details in §9.1.

3. **A quarter of the application has no test target at all, and a third of the service layer
   has no spec.** `libs/features/trash` is a fully routed, nav-linked feature with 1,091 lines
   of TypeScript, **no `test` target in its `project.json`** and zero specs — so adding a spec
   would not even run. It owns `restoreDocument` and `permanentlyDelete`, two irreversible
   operations untested at every tier. Separately, 15 of 27 services in
   `libs/shared/nuxeo-client` have no spec (1,721 lines), including `search.service.ts` at 839
   lines, which backs `/search`, `/trash`, `/documents` and the note document picker.

4. **The coverage ratchet is red on `main` and runs in no workflow, and the app shell is invisible
   to it.** `npm run beta:coverage` exits 1 today. `nuxeo-ui` is absent from the ratchet
   entirely — because its `test` target is `ng test … --browsers=ChromeHeadless` (Karma/Jasmine,
   not Vitest), and `nx run-many -t test --coverage` **fails outright** on it with `Error:
Unknown argument: coverage`. The SonarCloud workflow runs exactly that command on every PR
   under `continue-on-error: true`, so this has been failing silently. 18 spec files and 135
   test cases — including the auth service, the auth interceptor and session timeout — are
   measured by nothing.

### 1.4 What is genuinely good

Stated because an audit that only lists faults misleads about where effort should go. The
`adf-hx-bridge` API-port specs, the `nuxeo-client` service specs for `document-detail` and
`browse`, the `libs/shared/extensions` Layer 0/1 specs and the three auth specs in
`apps/nuxeo-ui` are assertion-bearing, comment _why_ each assertion can fail, and in several
places record the negative control that proved it. `e2e-preflight.mjs` is a well-designed
precondition gate. The problem is not that the existing tests are weak on average — it is that
there is a whole tier missing, and that the tests which exist are not run by anything.

---

## 2. Architecture and test-stack discovery

### 2.1 Projects and test targets

- **27 Nx projects** total (`nx show projects`); **20 carry a `test` target**
  (`nx show projects --with-target test`).
- The 7 without a `test` target: `@nuxeo-satori/generators`, `ng-mocks`,
  `nuxeo-satori-template`, `nuxeo-ui-e2e`, `platform`, `shared-util`, **`trash`**.
- `nuxeo-ui-e2e` is deliberately excluded and documents why in
  `apps/nuxeo-ui-e2e/project.json` under `$noTestTarget` — end-to-end specs in the coverage
  ratchet's population would be measured at 0% and drag the gate, or be excluded and make its
  project count a lie. **This is correct and should stay.**
- **`trash` is not deliberate.** It is a routed, nav-linked feature library with only a `lint`
  target. See §6.2.

### 2.2 Two test runners, not one

This is not documented anywhere and is the root of finding §1.3.4.

- **19 library projects run Vitest** via `vite.config.mts`, each as its own Nx `test` target. A root
  `vitest.workspace.ts` listed them until Vitest 4, which no longer reads that file; it was deleted
  rather than replaced, because nothing ran Vitest from the workspace root.
- **`nuxeo-ui` runs Karma + Jasmine.** `apps/nuxeo-ui/project.json:51-57` declares
  `ng test nuxeo-ui --no-watch --browsers=ChromeHeadless`; `angular.json` wires
  `@angular/build:karma` with `apps/nuxeo-ui/karma.conf.js`. There is no `vite.config.mts` and
  no `test-setup.ts` under `apps/nuxeo-ui`.
- `AGENTS/05-test-standards.md` opens with "Framework: **Vitest** + Angular Testing Utilities"
  and `CLAUDE.md` describes only the Vitest path. Neither mentions Karma. Consequences: four
  app specs use Jasmine-only constructs (`jasmine.createSpyObj`, `toBeFalse()`, `toBeTrue()`,
  `withContext()`) that cannot be copied into a library; the app carries a hard headless-Chrome
  dependency no library has; and the Node-20 `localStorage` workaround `beta:gate` applies is
  Vitest-only.

### 2.3 Vitest configuration

Uniform across the 19 library configs, with two deliberate settings and one latent risk:

- `pool: 'threads'` — pinned because the default pool hangs under Node 20 in Nx/CI after the
  first spec file completes. Documented in each config.
- `forceExit: true` — zone.js keeps the event loop alive after TestBed teardown.
- `environment: 'jsdom'`, `globals: true`, `reporters: ['default']`, per-project
  `setupFiles: ['src/test-setup.ts']` (18 of 19 present).
- `coverage.provider: 'v8'`, `reporter: ['text','html','clover','json','lcov']`. The explicit
  `lcov` is load-bearing: the Nx executor accepts `--coverage.reporter` and silently drops it,
  which is why SonarCloud once reported 0.0%.
- **`passWithNoTests: true`** appears in 9 configs. The plan flagged this as an active defect
  ("a project with zero specs passes"). **Corrected:** it is a latent risk, not an active
  defect — every one of the 20 test-target projects currently has at least one spec. It becomes
  real the moment a new library is scaffolded, or the moment someone adds a `test` target to
  `trash` without adding a spec.

### 2.4 Workflows

**14 workflows**, not 15. Only four touch tests or quality:

- **`ci.yml`** — one job, `lint-build-test`, on PR to `main` and on push to `main`/`feature/**`/
  `fix/**`. Runs guardrails and their self-tests, 8 static `beta:*` gates, `nx affected -t lint`,
  `nx affected -t build`, a test step, `nx affected -t typecheck`, 5 published-package checks and
  a bundle-size check. The test step is _not_ purely affected — it force-runs `document-detail`,
  `knowledge-discovery`, `search` and `browse` unconditionally, then runs affected with those
  four excluded. No Playwright step, no `beta:e2e`, no `beta:coverage`.
- **`sonarcloud.yml`** — on every PR. **Runs the full suite**: `npx nx run-many -t test
--coverage --parallel=1`, under `continue-on-error: true`, then merges lcov and publishes. The
  quality gate step is also `continue-on-error: true`, with the reasoning recorded in the file
  (new-code coverage 0.0%, security rating E, reliability D on a 729-file diff). So the full
  suite _does_ run per-PR — and cannot fail the build, and has been failing on `nuxeo-ui` the
  whole time (§4.2).
- **`a11y.yml`** — static template accessibility scan on every PR. Its trailing comment is an
  unusually honest account of why the live-server axe scan cannot run on a GitHub-hosted runner
  (needs a live Nuxeo; no compose file; no `packages.nuxeo.com` credentials). That reasoning
  applies verbatim to the integration tier proposed in §11 and §12.
- **`codeql.yml`**, **`dependency-review.yml`** — security, not test tiers.

Nothing runs on a schedule except `stale`, `staleness-check`, `dead-code` and `crowdin-pull`.
**No workflow runs Playwright. No workflow runs `beta:coverage`. No workflow runs the
beta-harness evidence steps.**

### 2.5 Quality tooling

- `sonar-project.properties` — `sonar.exclusions` drops `**/*.spec.ts`, `**/e2e/**`,
  `**/scripts/**`; coverage comes from one merged `coverage/lcov.info` written by
  `scripts/lcov-merge.mjs`.
- `eslint.config.mjs` — real `depConstraints` since 2026-08-24; every project carries `scope:`
  and `type:` tags. Relevant to §11: a new `libs/shared/testing` library needs tags before
  anything can import it, and a `type:testing` tag that every project may depend on weakens the
  boundary the constraints exist to enforce. Called out as a trade-off in §10.
- `.ai/state/coverage-baseline.json` — ratchet baseline, **16 projects**; the gate measures
  **19**; `nuxeo-ui` is in neither.
- `scripts/beta-harness/` — 13 evidence steps plus `_template.mjs`, `phase-runner.mjs`
  (exit 0 pass / 1 fail / 2 precondition-not-met; a run with zero checks is not a pass),
  `assertion-audit.mjs` (static acorn parse for assertions that cannot be false; runs in CI),
  `coverage-gate.mjs`, `e2e-preflight.mjs`.

### 2.6 Corrections to the plan's stated ground truth

Each was re-derived first-hand; the plan's figures appear to predate `origin/main@0ced6667`.

- "21 Nx projects carry a `test` target" → **20**.
- "187 `*.spec.ts` files" → **184** (179 non-Playwright + 5 Playwright).
- "127 use `TestBed`" → **126**. "42 use `HttpTestingController`" → **42**, confirmed.
- "14 evidence steps in `scripts/beta-harness/steps`" → **13** step files plus `_template.mjs`.
- "all 15 workflows" → **14**.
- "`apps/nuxeo-ui-e2e/screenshot-debug.spec.ts` sits at the app root and never runs" → **that
  file does not exist.** Not on disk, not untracked, and `git log --all --diff-filter=AD
-- '*screenshot-debug*'` returns nothing — it has never existed in this repository's history.
  **The plan's and the ticket's "a spec that never runs" finding is withdrawn.**
- "~21 Playwright cases" → **19**, confirmed by run output on both engines.
- The plan did not state, and this audit found, that `nuxeo-ui` runs Karma rather than Vitest.

### 2.7 Phase 1 verification

- **Passed.** `nx show projects --with-target test` returns 20; 19 reconcile to a
  `vite.config.mts` on disk and the 20th (`nuxeo-ui`) reconciles to the `ng test` command in
  `project.json` plus the `@angular/build:karma` builder in `angular.json`. No library directory
  is unaccounted for: the 7 projects without a test target were each opened and classified
  (§2.1).
- **Commands:** `nx show projects`, `nx show projects --with-target test`,
  `nx show project nuxeo-ui --json`, `rg --files -g '*.spec.ts'`, `find … -name vite.config.mts`,
  `find … -name test-setup.ts`, `ls .github/workflows/`, `git log --all --diff-filter=AD`.
- **Gap:** none.

---

## 3. Inventory and classification

Full machine-readable inventory: `~/Desktop/agentic-ui-evidence/NXSAT-286/audit/inventory.json`,
one row per spec file with 26 fields, produced by `audit/inventory.mjs` (a read-only script kept
outside the repo). Summary: `audit/logs/inventory.txt`.

### 3.1 Counts

- **184 `*.spec.ts` files** — 179 in-process, 5 Playwright.
- **Per project** (files / static case count / lines): `nuxeo-client` 45/665/10,204 ·
  `adf-hx-bridge` 32/444/6,703 · `document-detail` 22/554/10,334 · `nuxeo-ui` 18/120/2,699 ·
  `browse` 12/403/8,219 · `ui` 11/141/2,289 · `shared-extensions` 10/93/1,595 ·
  `nuxeo-ui-e2e` 5/19/545 · `shared-app-config` 4/58/731 · `shared-kd-client` 4/88/2,033 ·
  `administration` 3/25/641 · `knowledge-discovery` 3/25/709 · `permission-dialogs` 3/18/494 ·
  `acme-extensions` 2/9/131 · `collections` 2/89/1,422 · `search` 2/111/1,655 ·
  `shared-ke-client` 2/31/753 · `assets` 1/7/190 · `core` 1/1/22 · `shared-ai-client` 1/10/89 ·
  `tasks` 1/7/269.
- Static case counts are approximate (they do not expand `it.each`); the executed counts in §4
  are authoritative.

### 3.2 Status taxonomy

Applied across all 184 files.

- **complete** — 96 files. Multiple collaborators or a full method surface exercised, error
  paths present, assertions tied to observable state. Concentrated in `adf-hx-bridge/api/*`,
  `nuxeo-client/services/document-detail.*`, `browse.service.*`, `shared/extensions/*`,
  `apps/nuxeo-ui/src/app/auth/*`, `apps/nuxeo-ui/src/app/i18n/*`.
- **partial** — 54 files. Happy paths only, or a subset of the unit's surface. Includes every
  service spec named in §7 as having untested methods.
- **weak** — 21 files. Assertions that are tautologies, presence-only, or `toBeTruthy()` on
  something always defined. Named individually in §9.1.
- **not-actually-integration** — **all 179 in-process specs.** Stated once rather than repeated:
  every one mocks the network, so none is an integration test under any definition the team
  would recognise. This is the audit's central finding and the taxonomy's most important row.
- **skipped** — 2 occurrences, both conditional `test.skip(cond, …)` in
  `cross-browser.spec.ts:108` and `:165`. Neither is an unconditional skip. Reasons and the
  coverage lost when each fires are in §5.2.
- **disabled** — 0. No `.skip` describe blocks, no `xit`, no `xdescribe`.
- **todo** — 0. **only** — 0 (`forbidOnly: true` in the Playwright config would reject one).
- **flaky** — 0 observed. Three runs per Playwright engine and the full Vitest suite produced
  identical verdicts with no retry-passes (§4.5). Nine specs carry _flakiness risk_ that did not
  manifest; listed in §9.9.
- **broken** — **5 files**, all five orphaned `.mjs` scripts in `apps/nuxeo-ui/e2e/`. Executed;
  all five exit 1 (§4.4).
- **blocked** — 0. Everything in scope was executable. The blockers found were in the _scripts_,
  not the environment.

### 3.3 Tier classification

- **Tier 1 — in-process, network mocked (179 files, 3,016 cases).** 126 use `TestBed`; 42 use
  `HttpTestingController`; the remainder are pure-function specs over `libs/*/utils/`.
- **Tier 2a — real browser, real Nuxeo, governed as tests (5 files, 19 cases × 2 engines).**
  The Playwright suite.
- **Tier 2b — real browser, real Nuxeo, governed as evidence (13 files).** The beta-harness
  steps. Functionally integration tests: they visit real routes, assert rendered repository
  data, and `phase-runner.mjs` treats zero checks as a failure. They are not run by any workflow
  and their results live outside the repo.
- **Tier 2c — orphaned (5 files).** Referenced by no npm script, Nx target, workflow or
  document. Verified by repo-wide search including `.github/`, `package.json`, every
  `project.json`, `docs/`, `documentation/`, `.cursor/`, `.claude/`, `.agent/`. The only hits are
  `.nx/workspace-data/file-map.json` (generated) and unrelated same-named application source.
- **Tier 3 — integration.** **Empty.**

### 3.4 Phase 2 verification

- **Passed.** Inventory row count is 184; `rg --files -g '*.spec.ts' | wc -l` is 184. Both
  `.skip` occurrences appear in the inventory with a reason and a stated coverage loss. Zero
  `.only`, zero `.todo`, zero unconditional skips — each confirmed by a separate `rg` pattern
  rather than inferred.
- **Commands:** `node audit/inventory.mjs`, `rg --files -g '*.spec.ts' | wc -l`,
  `rg -n '\b(it|describe|test)\.(skip|todo)\b|\bxit\(|\bxdescribe\('`,
  `rg -n '\b(it|describe|test)\.only\b'`.
- **Gap:** the plan asked for a 20-field schema per spec. The inventory carries 26 mechanical
  fields per file; the _qualitative_ fields (status, risk, recommendation) are applied per group
  in §3.2 and per file only where the finding is specific, rather than 184 times. Recorded as a
  deliberate deviation, not an omission.

---

## 4. Execution results

Everything below was run serially in the worktree on the reserved port 4210. Raw stdout and
stderr for every command is in `~/Desktop/agentic-ui-evidence/NXSAT-286/audit/logs/`.

### 4.1 Vitest — the 19 library projects

`npx nx run-many -t test --coverage --parallel=1 --output-style=stream --skip-nx-cache`
→ log `vitest-runmany.log`, **147 s wall** (325 s user).

**161 files, 2,881 tests, 2,881 passed, 0 failed, 0 skipped.**

Per project (files / tests / Vitest-reported duration):

- `nuxeo-client` 45 / 724 / 12.56 s
- `adf-hx-bridge` 32 / 453 / 13.02 s
- `document-detail` 22 / 560 / 6.80 s
- `browse` 12 / 403 / 6.93 s
- `ui` 11 / 151 / 4.11 s
- `shared-extensions` 10 / 98 / 2.24 s
- `shared-app-config` 4 / 71 / 1.54 s · `shared-kd-client` 4 / 88 / 1.94 s
- `administration` 3 / 25 / 2.81 s · `knowledge-discovery` 3 / 25 / 2.51 s ·
  `permission-dialogs` 3 / 18 / 2.05 s
- `acme-extensions` 2 / 9 / 1.74 s · `collections` 2 / 89 / 2.88 s · `search` 2 / 111 / 2.62 s ·
  `shared-ke-client` 2 / 31 / 1.81 s
- `assets` 1 / 7 / 1.92 s · `core` 1 / 1 / 1.31 s · `shared-ai-client` 1 / 10 / 0.63 s ·
  `tasks` 1 / 7 / 2.77 s

The gap between 147 s wall and ~72 s of summed Vitest durations is Nx task overhead and Angular
compilation at `--parallel=1`. `nuxeo-client`'s own line reports 121 s of _environment_ time
against 12.56 s total, i.e. jsdom construction dominates and is parallelised across threads.

### 4.2 The `--coverage` defect

**`nx run-many -t test --coverage` fails.** Exit 1, one failed task:

```
> nx run nuxeo-ui:test --coverage
nuxeo-ui: Error: Unknown argument: coverage
NX   Running target test for 20 projects failed
Failed tasks: - nuxeo-ui:test
```

`nuxeo-ui`'s target is `nx:run-commands` wrapping `ng test`, which does not accept `--coverage`;
Nx forwards the flag and `ng` rejects it. Consequences, in order of severity:

1. **`sonarcloud.yml` runs exactly this command on every PR** and has therefore been failing on
   `nuxeo-ui` continuously. It is invisible because the step is `continue-on-error: true`.
2. `nuxeo-ui` contributes **no lcov**, so it is absent from the merged coverage SonarCloud
   publishes and absent from the ratchet.
3. 18 spec files and 135 cases — `auth.service`, `nuxeo-auth.interceptor`,
   `session-timeout.service`, `share-token.util`, `login-page`, `profile-page`, the shell a11y
   specs, the i18n loader and locale registration, `provide-app-config`,
   `provide-manifest-refresh` (deleted in NXSAT-312), `provide-app-extensions`, `platform-nav-items` — are measured by
   nothing.

Run without the flag, the project is healthy: `npx nx run nuxeo-ui:test` → **135 of 135 SUCCESS,
17.0 s**, Chrome Headless 153.0.0.0. One benign warning: `404: /base/media/Figtree.woff2`.

### 4.3 Combined in-process totals

**179 spec files, 3,016 test cases, 3,016 passed, 0 failed, 0 skipped**
(2,881 Vitest + 135 Karma). Wall clock 147 s + 17 s = **164 s**.

### 4.4 The coverage ratchet

`npm run beta:coverage` → **exit 1**, log `beta-coverage.log`. It is red on `main` today, and no
workflow runs it.

- **19 projects measured**, Beta target 90%. `nuxeo-ui` is not among them.
- **Below 90%:** `shared-ai-client` 16.51% (in-scope, 73.49 pp short), `tasks` 43.81%,
  `acme-extensions` 53.47%, `administration` 62.08%, `knowledge-discovery` 65.68%. The last four
  are recorded as out of Beta scope; `shared-ai-client` is the one in-scope project that misses
  the bar.
- **Why it fails:** 3 unratcheted projects (`assets`, `shared-ai-client`, `tasks` are measured
  but absent from the baseline, so their coverage could fall to zero unnoticed), 8 unlisted
  uninstrumented files, 5 stale allowlist entries naming files now covered or gone.
- **Four projects improved** since the baseline and have never been locked in: `adf-hx-bridge`
  +8.02 pp, `search` +3.40 pp, `collections` +0.91 pp, `knowledge-discovery` +0.91 pp.
- The gate's own output is worth quoting because it pre-empts the misreading: "_8,819 line(s)
  are in that state… A percentage in this table is a statement about the measured subset, not
  about the project._" And: "_14 of 19 measured project(s) meet 90%… Of those, 1 clears the bar
  over fewer than 20 statements — core (7)… Substantively covered: 13._"

For context, `npm run beta:state` also exits 1 on `main`: 6 phases cite gate reports 333 commits
behind HEAD with 179 source files changed since.

### 4.5 Playwright — reported per engine, never merged

Preconditions, `node scripts/beta-harness/e2e-preflight.mjs` with `E2E_BASE_URL=http://localhost:4210`
→ **exit 0**: `@playwright/test` 1.63.0 importable, chromium 153.0.8010.12 launches, webkit 26.6
launches, app answers 200, **Nuxeo holds 42 File documents**.

One finding from the preflight itself: it **passed without `NUXEO_USER`/`NUXEO_PASS` exported**,
because both it and `playwright.config.ts:61-62` default to `Administrator`/`Administrator`. See
§5.4.

Three runs per engine, single worker, `retries: 1` locally:

| Engine   | Cases | Run 1                   | Run 2               | Run 3               | Wall               | Flaky |
| -------- | ----- | ----------------------- | ------------------- | ------------------- | ------------------ | ----- |
| chromium | 19    | **19 passed**           | 19 passed           | 19 passed           | 55 s / 52 s / 50 s | 0     |
| webkit   | 19    | **17 passed, 2 failed** | 17 passed, 2 failed | 17 passed, 2 failed | 98 s / 96 s / 96 s | 0     |

Both engines together, via the Nx target — the documented path, and equivalent to
`npm run beta:e2e`:

`npx nx run nuxeo-ui-e2e:e2e` → **38 tests, 36 passed, 2 failed, 165 s, exit 1.**
`NX Running target e2e for project nuxeo-ui-e2e failed.`

**The two failures are the same two cases on every run, and they fail on Playwright's retry as
well as on the first attempt. Zero flaky verdicts, zero retry-passes, on either engine.** WebKit
is ~1.8× slower than Chromium, entirely accounted for by the two 11.3 s timeouts.

### 4.6 The five orphaned scripts

All executed against the same served app, with `AGENTIC_UI_BASE_URL=http://localhost:4210`,
`NUXEO_TEST_USER`/`NUXEO_TEST_PASSWORD=Administrator`, `AGENTIC_UI_HEADED=0`. Logs
`orphan-*.log`.

**All five fail. Exit 1, every one.**

| Script                          | Exit | Elapsed | Failure point                                                                                      |
| ------------------------------- | ---- | ------- | -------------------------------------------------------------------------------------------------- |
| `session-timeout.mjs`           | 1    | 11 s    | `TimeoutError` waiting for `.mat-mdc-snack-bar-container`                                          |
| `clipboard-move-scenarios.mjs`  | 1    | 31 s    | `locator.fill` timeout on `input[autocomplete="username"]` — **after** creating its Nuxeo fixtures |
| `note-document-scenarios.mjs`   | 1    | 65 s    | `locator.waitFor` timeout on `input[autocomplete="username"]`                                      |
| `permission-notification.mjs`   | 1    | 60 s    | same, and it wrote PNGs **inside the repository**                                                  |
| `profile-auth-verification.mjs` | 1    | 30 s    | same                                                                                               |

**Root cause, one for all five:** each navigates to `/#/login` and drives a **two-step login
flow** — fill username → click `Continue` → fill password → click `Continue`. That flow no
longer exists. `login-page.component.html` is a single-step form whose submit button is `Log in`;
`rg 'Continue' apps/nuxeo-ui/src/app/login/` returns nothing. On this instance the guard also
redirects an already-authenticated visitor away from `/#/login`, so the username input never
appears at all. Both conditions are fatal and independent.

Two side effects observed, each confirming a defect the static read predicted:

- **`clipboard-move-scenarios.mjs` leaked fixtures into the shared Nuxeo before dying.** Verified
  by NXQL afterwards: 2 folders left behind,
  `/default-domain/workspaces/nxsat183-source-17899611` and `…-target-17899611`. The script has
  no teardown on any path.
- **`permission-notification.mjs` wrote into the working tree** —
  `apps/nuxeo-ui/e2e/screenshots/nxsat-159/{FAIL-final-state.png,report.json}`, untracked and not
  covered by `.gitignore` (which ignores `__screenshots__/`, not `screenshots/`). Removed after
  the run; `git status` is clean.

### 4.7 What could not be executed

Recorded in the format the plan requires. There is exactly one item.

- **The 13 beta-harness evidence steps were not executed.**
  - _Exact command:_ `npm run beta:evidence -- <phase-id>` for each of the 13.
  - _Blocker:_ not a missing dependency — a scope and safety judgement. Several steps mutate
    state the audit must not touch: `phase-1-config` and `phase-2-registry` rewrite
    `bootstrap.json` and the runtime manifest in the working tree and hash the built bundle;
    `phase-3-adf-hx` creates a versions fixture in the shared Nuxeo; `phase-4-platform` and
    `phase-5-harness` require `nx build platform` output and serve on ports 4321/4322, which are
    not this worktree's reservation. Running them would have written files in the repository,
    contradicting the one-file constraint, and would have contended with six other live
    worktrees.
  - _Required dependency:_ a reserved port pair beyond 4210, a `dist/libs/platform` build, and
    explicit approval to let a step modify tracked configuration files.
  - _Recommended execution route:_ run them individually under
    `AGENTIC_UI_EVIDENCE_DIR` pointed at the evidence tree, on a machine where the worktree may
    be dirtied, as part of Stage 9 in §11 rather than as part of this audit.
  - _Affects:_ **local only.** They run in no workflow today, so CI is unaffected either way.
  - They were fully analysed statically instead: assertion counts, routes visited, browser-vs-file
    character, and two live defects found in them (§9.11).

### 4.8 Phase 3 verification

- **Passed.** Every failure and skip carries a root-cause classification (§5). Every E2E result
  is attributed to a named engine and no per-engine result is merged anywhere in this document.
  The one non-executed item is recorded in §4.7 in the required format with its exact command,
  blocker, dependency, route and local/CI scope.
- **Commands:** as quoted inline above, plus `npm run beta:state` for context.
- **Gap:** §4.7.

---

## 5. Failure, skip and blocker classification

### 5.1 Failures — 2, both real, both WebKit-only

**`auth.spec.ts:66` — "login form stays usable in forced-colors (Windows high contrast) (NXENG-751)"**
**`auth.spec.ts:100` — "Log in shows a visible focus indicator when reached via Tab (NXENG-750)"**

- **Classification:** engine-specific product/test contract mismatch. Not flaky, not
  environmental, not a fixture problem.
- **Assertion that fails:** `await expect(submit).toBeFocused()` after four `Tab` presses, where
  `submit` is `button.login-submit`. WebKit reports `inactive`; 24 locator resolutions, 10 s
  timeout, identical on retry.
- **Root cause:** the button is
  `<button type="submit" … disabledInteractive [disabled]="submitDisabled()">`
  (`login-page.component.html:59-66`). With the form empty it renders `aria-disabled="true"` and
  `mat-mdc-button-disabled`. Angular Material's `disabledInteractive` keeps it in the DOM focus
  order, which Chromium honours; WebKit on macOS follows the platform default in which `Tab`
  moves between text fields and lists only, not buttons, unless Full Keyboard Access is enabled.
  The two tests encode Chromium's tab semantics.
- **Why it is on `main`:** the `webkit` project was registered on **2026-08-25** (`c01f0e92`,
  "cross-browser verified on Chromium and WebKit") with the config comment "_Registered only once
  the suite passed on it. A project that needs `test.skip` per spec reads as coverage it is
  not._" These two tests were added on **2026-09-17** (`d2cc4167`, `cd52fa4a`) and **2026-09-18**
  (`dd6b6e4b`). They post-date the claim, were validated on Chromium, and landed WebKit-red.
  Nothing ran the suite, so nothing noticed.
- **Is it a product defect?** Judgement, not measurement, and it needs a team decision (§14.3):
  a disabled-but-interactive submit button that Safari users cannot reach by keyboard is
  arguably the accessibility defect NXENG-750 was raised to fix, in which case the test is right
  and the app is wrong. The alternative reading is that the platform default makes the
  assertion untestable on WebKit and it should be `.focus()`-based or engine-scoped. **What is
  not in doubt is that the config's "verified on WebKit" claim is false today.**

### 5.2 Skips — 2, both conditional, both able to hide the regression they guard

**`cross-browser.spec.ts:108`** — `test.skip(count === 0, 'no blob-backed thumbnails at the
repository root on this instance')`.
Coverage lost when it fires: everything after line 110 — the blob-decode verification, which is
the whole test. `count === 0` is also exactly what a _completely broken blob pipeline_ produces.
The preceding guard, `expect(nuxeoSourced).toEqual([])`, is vacuous on an empty page, and the
data assertion above it is the `'Root'` pulse check (§9.1). So a total blob-rendering regression
would report as a **skip**, i.e. green. The test's own comment claims this cannot happen.
Did not fire in any of the six runs.

**`cross-browser.spec.ts:165`** — `test.skip((await region.count()) === 0, 'no widget-body
rendered on the landing surface')`.
Coverage lost: the `tabindex="0"` and focus assertions for WCAG 2.1.1. This one is the _good_
version — the file records that an earlier form selected `.widget-body[tabindex="0"]`, so
removing the fix caused a skip rather than a failure, and that a negative control caught it. The
residual gap is narrower: only a dashboard that renders no widgets at all skips silently.
Did not fire in any of the six runs.

### 5.3 Broken — 5, all the orphaned scripts

Classified **broken**, not **blocked**: the environment was present and correct; the scripts
encode a UI flow the application removed. Per-script detail in §4.6; recommendations in §13.

### 5.4 Environment observations

- **Node.** Machine default is v25.2.0; `.nvmrc` pins 20. Everything here ran on v20.20.2. A bare
  `nx test` on 22+ hits the built-in `localStorage` shadowing jsdom's. **Affects local only** —
  CI pins `node-version: 20` in all four relevant workflows.
- **Credentials.** `NUXEO_USER`/`NUXEO_PASS` are not exported in a fresh shell, and the suite
  still runs, because `e2e-preflight.mjs:21-22` and `playwright.config.ts:61-62` both default to
  `Administrator`/`Administrator`. This is worth recording precisely, because it cuts two ways.
  It is _not_ a hardcoded-credential violation in the sense `AGENTS/07-security.md` prohibits —
  the value is read from the environment first. But the fallback is the well-known default admin
  password, so (a) the suite's dependency on credentials is invisible until it is pointed at a
  non-default instance, where it will fail as 19 product failures rather than one missing
  variable, and (b) the preflight, whose entire purpose is to convert environment problems into
  exit code 2, cannot detect this particular one. **Affects local and CI** — any CI job added
  under NXSAT-231 must set both explicitly and should fail fast if they are unset.
  Recommendation R11 in §13.
- **One genuine hardcoded credential exists** and is a rule violation:
  `scripts/beta-harness/steps/phase-3-search.mjs:46`,
  `` const AUTH = `Basic ${Buffer.from('<default-docker-user>:<default-docker-pass>').toString('base64')}` `` (since removed).
  Every other harness file uses `process.env['NUXEO_USER'] ?? 'Administrator'`.
- **Shared Nuxeo.** 42 File documents; `/default-domain/workspaces` writable. Two folders leaked
  by the clipboard script during this audit remain (§4.6) — harmless, but they are litter in a
  container six other worktrees share.

---

## 6. Coverage matrix — feature modules and routes

Every route in `apps/nuxeo-ui/src/app/app.routes.ts` appears exactly once across §6.1 and §6.2.

### 6.1 The eight named feature modules

- **browse** — `/#/browse` → `BrowseComponent`.
  _Integration points:_ folder navigation, listing, column config, context menu, permissions
  gating, clipboard, CSV export, thumbnails.
  _Existing:_ 12 Vitest specs / 403 cases, 99.02% lines (the best-covered feature). E2E: 3 cases,
  of which two rely on the `'Root'` pulse check and one asserts root children are _named_ without
  ever clicking into a folder.
  _Status:_ unit complete, integration absent, E2E weak.
  _Risk:_ **Medium.** _Recommended:_ service-level integration + one E2E navigation-and-write
  journey. _Priority:_ **P1.** _Effort:_ Medium. _Blockers:_ none.

- **search** — `/#/search` → `SearchComponent`.
  _Integration points:_ NXQL/HXQL generation, OpenSearch index, filters drawer, saved searches,
  quick filters, sorting, pagination, AI NL→NXQL, CSV export.
  _Existing:_ 2 Vitest specs / 111 cases, 94.56%. E2E: 3 cases, **two of which exercise nothing**
  because `?q=` is inert (§9.1). `search.service.ts` (839 lines) has **no spec at all**.
  _Status:_ partial; the security regression guard is non-functional.
  _Risk:_ **High** — highest in the matrix. _Recommended:_ service-level integration against a
  live index, plus repair of the two inert E2E cases. _Priority:_ **P0.** _Effort:_ Large.
  _Blockers:_ needs a populated OpenSearch index, which `e2e-preflight` does not currently check.

- **document-detail** — `/#/doc/:uid` → `DocumentDetailComponent`.
  _Integration points:_ metadata, tabs (manifest-driven), permissions, versions, publishing,
  comments, audit, viewer, note editor, attachments.
  _Existing:_ 22 Vitest specs / 560 cases, 92.73% — the largest spec set. E2E: 3 cases, one of
  which (`document-detail.spec.ts:59`) is the **correct** use of `expectSurfaceWithData`, passing
  a UID-specific title discovered via the API.
  _Status:_ unit complete, integration absent, E2E thin but sound.
  _Risk:_ **Medium.** _Recommended:_ integration for the write paths — version create/restore,
  ACL write, publish. _Priority:_ **P1.** _Effort:_ Large. _Blockers:_ none.

- **collections** — `/#/collections/:uid` → `CollectionDetailComponent`.
  _Existing:_ 2 Vitest specs / 89 cases, 94.96%. **E2E: none.** `collection.service.ts`: no spec.
  _Status:_ unit partial, E2E absent. _Risk:_ **Medium.** _Recommended:_ service integration +
  one E2E add/remove journey. _Priority:_ **P2.** _Effort:_ Medium. _Blockers:_ none.

- **tasks** — `/#/tasks`, `/#/tasks/:taskId` → `TasksPageComponent`.
  _Existing:_ 1 Vitest spec / 7 cases covering **only** viewer MIME handling; 43.81% lines.
  `task.service.ts` and `workflow.service.ts`: no specs. **E2E: none.**
  _Status:_ weak. `completeTask`, `reassignTask`, `delegateTask`, `startWorkflow`,
  `cancelWorkflow` are untested at every tier.
  _Risk:_ **High** — a shape regression in the `PUT /task/:id` form body silently fails every
  approval. Mitigated only by the project being out of Beta scope.
  _Recommended:_ service integration against real workflow instances. _Priority:_ **P2**
  (P1 if workflow enters Beta scope). _Effort:_ Large. _Blockers:_ needs a deployed workflow model.

- **administration** — `/#/administration/**` → 9 child routes.
  _Existing:_ 3 Vitest specs / 25 cases, 62.08%. Only `users-groups` of the nine children has a
  spec. **E2E: one negative case only** — `auth.spec.ts:135` asserts an anonymous visitor is
  redirected _away_. No test ever loads the administration UI as an administrator.
  _Status:_ weak. _Risk:_ **Medium** (out of Beta scope) / **High** for the NXQL console, which
  executes arbitrary queries with no test on query construction.
  _Recommended:_ smoke E2E per child route + integration for the NXQL console and audit search.
  _Priority:_ **P2.** _Effort:_ Large. _Blockers:_ needs a non-admin fixture user.

- **assets** — `/#/documents` → `AssetSearchResultsComponent`.
  _Existing:_ 1 Vitest spec / 7 cases over a sibling drawer; the route component itself has **no
  spec**. 97.40% — a figure over a measured subset that excludes three files entirely, and the
  project is one of the three absent from the ratchet baseline. **E2E: none.**
  _Status:_ weak; the percentage is misleading. _Risk:_ **Medium.** _Recommended:_ component spec
  - E2E smoke. _Priority:_ **P2.** _Effort:_ Medium. _Blockers:_ none.

- **trash** — `/#/trash` → `TrashComponent`. **See §6.2. The worst gap in the repository.**

### 6.2 `libs/features/trash` — no test target, no specs, 1,091 lines

- `trash.component.ts` 688 lines · `trash-filters-drawer.component.ts` 403 lines ·
  `lib.routes.ts` 4 lines. Plus 653 lines of template with embedded logic.
- **`project.json` declares only `lint`.** This is not "no specs written" — adding a spec would
  not run under `nx test`, `nx affected -t test`, `beta:gate` or the SonarCloud coverage run.
- **Fully reachable:** route at `app.routes.ts:100-103` inside the `authGuard` shell; nav entry
  `app.navbar.trash` at `libs/shared/extensions/src/lib/nav-items.ts:144-151` with **no rule**,
  so visible to every authenticated user; filters drawer registered as a lazy extension at
  `provide-app-extensions.ts:128-129`.
- **What is untested:** `restoreDocument` and `permanentlyDelete` — irreversible, and also
  untested in `trash.service.ts`, so they have no coverage at any tier. A generation counter in
  `search()` added to fix a stale-response race (the comment describes the bug) that can be
  removed or inverted with a green build. A load-bearing ordering in `clearThumbnails()` —
  `forgetPreviews()` before revoking, so selection cannot bind revoked blob URLs into
  `<img [src]>` — which the equivalent code in browse, search and assets _does_ have tested.
  Hand-rolled CSV escaping. A `JSON.parse` fallback in saved-search parsing that silently loads
  wrong filters. Facet counts computed over `pageSize: 200` while the table fetches
  `pageSize: 100`, neither asserted.
- _Risk:_ **Critical.** _Recommended:_ add the `test` target first, then component + service
  specs, then an E2E restore/purge journey. _Priority:_ **P0.** _Effort:_ Large. _Blockers:_ none
  — this is pure debt.

### 6.3 Every other route

From `app.routes.ts`, each appearing once. **NO SPEC** means no Vitest spec for the component
behind it.

- `login` (`:13`) → `LoginPageComponent`, `loginGuard` — spec ✓ (Karma).
- `''` (`:18`) → `AppShellComponent`, `authGuard` — spec ✓ (`app-shell-header-a11y.spec.ts`).
- `dashboard` (`:24`) → `DashboardPageComponent` — **NO SPEC.** Visited by E2E only incidentally.
- `browse-adf-hx` (`:28`) → `BrowseAdfHxPocComponent` — **NO SPEC.** A Beta deliverable.
- `search-adf-hx` (`:33`) → `SearchAdfHxComponent` — **NO SPEC.** A Beta deliverable.
- `browse` (`:38`) → see §6.1.
- `contracts` (`:42`) → `ContractsPageComponent` — **NO SPEC.**
- `recently-viewed` (`:47`), `expired-queue` (`:60`), `favorites` (`:80`), `clipboard` (`:96`) →
  `PlaceholderPageComponent` — **NO SPEC.** Low risk; they are placeholders.
- `search` (`:51`) → see §6.1.
- `knowledge-discovery` (`:55`) → `KnowledgeDiscoveryComponent` — spec ✓ (3 specs, 65.68%).
- `doc` (`:64`) → see §6.1.
- `documents` (`:69`) → see §6.1 (assets).
- `tasks` (`:76`) → see §6.1.
- `collections` (`:84`) → see §6.1.
- `personal-space` (`:89`) → `PersonalSpacePageComponent` — **NO SPEC.**
- `trash` (`:100`) → see §6.2.
- `administration` (`:104`) → see §6.1. Children: `''`, `analytics`, `users-groups/user/:userId`,
  `users-groups/group/:groupId`, `vocabularies`, `audit`, `cloud-services`, `nxql-search` —
  **all NO SPEC**; only `users-groups` has one.
- `settings/profile` (`:117`) → spec ✓. `settings/nuxeo-drive` (`:110`),
  `settings/authorized-applications` (`:122`), `settings/cloud-services` (`:129`),
  `settings/themes` (`:136`) — **all NO SPEC.**

**Tally: 16 of 30 routable components have no Vitest spec. 4 of the 8 named routes have no E2E
coverage** (`/#/collections`, `/#/tasks`, `/#/documents`, `/#/trash`); `/#/administration` has a
negative guard assertion only.

### 6.4 Critical workflows with no coverage at any tier

**Not one Playwright case performs a write.** No test creates, modifies or deletes repository
data; none needs teardown; none has an `afterEach`.

Uncovered end to end: **upload/import** (the `Create / Import` button is asserted as _text_,
never clicked) · **download** (no `waitForEvent('download')` anywhere) · **delete / send to
trash** · **trash restore and permanent delete** · **permission grant and revoke** (only the
_word_ "Permissions" is asserted present) · **version create and restore** · **collection add and
remove** · **workflow task completion** · **note editing** · **CSV export** · **login submission**
(the form is never submitted, with valid or invalid credentials) · **logout** (the signed-out flag
is injected directly; sign-out is never clicked) · **session timeout** · **search filters drawer**
(the only code path that can actually set a search term) · **saved searches** · **folder
navigation by click** · **multi-select and bulk actions** · **extension-manifest rewiring at
runtime** (the Beta's headline contract) · **AI features**.

### 6.5 Phase 4 verification

- **Passed.** Every route in `app.routes.ts` appears exactly once across §6.1–§6.3, cross-checked
  against the file. Every service in `AGENTS/01-services.md` appears exactly once in §7,
  cross-checked against `ls libs/shared/nuxeo-client/src/lib/services/` rather than against the
  document, which is stale (§7.3).
- **Gap:** the plan expected the matrix as bullet lists rather than tables; §6.1–§6.4 comply.
  §6.3's route list is a bullet list; the two small tables in §1.2 and §4.5 are enumerable facts,
  not matrix content.

---

## 7. Coverage matrix — services

Derived from `ls libs/shared/nuxeo-client/src/lib/services/`, not from the documentation.
**27 service source files: 12 have at least one spec, 15 have none (1,721 lines).**

### 7.1 Services with specs — and what is still uncovered

- **`document-detail.service.ts`** (851 L) — `document-detail.service.spec.ts`,
  `…operations.spec.ts`. 61 public methods, **60 invoked**. Error paths extensive (404, 403,
  500). Uncovered: `removeAcl`. _Risk:_ an ACL-deletion regression silently leaves access
  granted. _Priority:_ P2, Small.
- **`browse.service.ts`** (647 L) — 3 specs. 19 methods, **17 invoked**. Uncovered: `getByPath`,
  `getCollectionMembers`. Note: the 7 "error" markers in `browse.service.spec.ts` are all 403s
  used as _intermediate steps in success paths_ (the `/path/` fallback chain); there is no test
  asserting that `getTreeChildren`, `copyDocuments`, `moveDocuments` or `updateDocument`
  propagate an error. _Risk:_ deep-linked browse URLs break untested. _Priority:_ P2, Small.
- **`document-import.service.ts`** (1,055 L) — 15 methods, **11 invoked**. Uncovered:
  `uploadFileToBatch`, `getEmptyDocumentWithDefaults`, `createFileFromBatch`. _Risk:_ **High** —
  `uploadFileToBatch` is the raw `PUT /api/v1/upload/{batch}/{index}`; a chunking or header
  regression breaks every upload and nothing calls it directly. _Priority:_ **P1**, Medium.
- **`user.service.ts`** (261 L) — 2 specs, **13/13 invoked**. `user.service.crud.spec.ts` has
  error paths; `user.service.spec.ts` has none. _Risk:_ Low. _Priority:_ P3, Small.
- **`settings.service.ts`** (219 L) — 2 specs, **6/6 invoked**. `settings.service.spec.ts` — the
  file covering `getLocalPermissions`, the ACL-read path — has **zero** error paths.
  _Risk:_ Medium. _Priority:_ P2, Small.
- **`directory.service.ts`** (320 L) — 12 methods, **7 invoked**; **zero error paths**.
  Uncovered: `getDirectoryCatalog`, `invalidateDirectoryCatalog`, `getL10nEntries`,
  `getEventTypes`, `getEventCategories`. _Risk:_ Medium — vocabulary pickers render empty on
  error; the audit page's event-type filter is wholly untested. _Priority:_ P2, Medium.
- **`selection.service.ts`** (160 L) — 10 methods, **4 invoked**. Uncovered: `isAllSelected`,
  `isIndeterminate`, `clear`, `resetUiState`, `setClearOnlyMode`, **`deleteSelected`**.
  _Risk:_ **High** — `deleteSelected` is a destructive bulk trash operation with no test.
  _Priority:_ **P1**, Small.
- **`trash.service.ts`** (194 L) — 7 methods, **2 invoked**; **zero error paths**. The spec is
  exclusively NXQL-literal escaping. Uncovered: **`restoreDocument`**, **`permanentlyDelete`**,
  `saveSearch`, `updateSearch`, `getSavedSearches`. _Risk:_ **Critical**, compounding §6.2.
  _Priority:_ **P0**, Medium.
- **`administration.service.ts`** (287 L) — 6 methods, **1 invoked** (`searchAuditLogs`), 1 error
  path. Uncovered: `nxqlSearch`, `getNxqlTotalSize`, `listOAuth2Providers`, `listDirectoryNames`,
  `getDefaultDomainPath`. _Risk:_ High for the NXQL console. _Priority:_ P2, Medium.
- **`arender.service.ts`** (207 L) — **3/3 invoked, but zero HTTP**: the spec makes no
  `expectOne`/`flush` at all, covering only config validation and URL rejection.
  `isAvailable()`'s server behaviour is untested. _Risk:_ Medium. _Priority:_ P2, Small.
- **`browse-context.service.ts`** (86 L) — 8 methods, **6 invoked**. Uncovered: `setFromRouterUrl`,
  `setFromDocument` — precisely the entry points the router and document-detail call, so the
  tree can desync from the URL untested. _Risk:_ Medium. _Priority:_ P2, Small.
- **`content-lake-ingest.service.ts`** (362 L) — **7/7 invoked**, 1 error path. _Risk:_ Low.
  _Priority:_ P3, Small.

### 7.2 Services with no spec at all — 15 files, 1,721 lines

Ordered by size. Every one is a **P0–P2** gap depending on blast radius.

- **`search.service.ts` — 839 L, 10 methods. The single largest untested unit in the repository.**
  Backs every search query, saved-search read and write, and the document picker. A
  query-building regression breaks `/#/search`, `/#/trash`, `/#/documents` and the note picker
  simultaneously. _Risk:_ **Critical.** _Priority:_ **P0.** _Effort:_ Large.
- **`task.service.ts`** — 142 L, 7 methods including `completeTask`, `reassignTask`,
  `delegateTask`. _Risk:_ High. _Priority:_ P2, Medium.
- **`principal-permissions.service.ts`** — 133 L, `listLocalPermissionRows`. An RBAC _display_
  path: misclassifying inherited as local lets a user "remove" a permission that does not exist.
  _Risk:_ **High.** _Priority:_ **P1**, Small.
- **`workflow.service.ts`** — 87 L, 9 methods including `startWorkflow`, `cancelWorkflow`.
  _Risk:_ High. _Priority:_ P2, Small.
- **`collection.service.ts`** — 81 L, 6 methods. Named a key service in `AGENTS.md` §3.
  _Risk:_ Medium. _Priority:_ P2, Small.
- **`nuxeo-drive.service.ts`** — 80 L, 4 methods including `buildEditUrl`,
  `buildDirectTransferUrl`. URL construction for an external protocol handler; a malformed
  `nxdrive://` URL fails silently in the OS. _Risk:_ Medium. _Priority:_ P2, Small.
- **`asset.service.ts`** — 67 L. The `/#/documents` page's only query. _Risk:_ Medium.
  _Priority:_ P2, Small.
- **`content-model.service.ts`** — 54 L. Schema-driven metadata forms. _Risk:_ Medium.
  _Priority:_ P2, Small.
- **`trash-filter.service.ts`** — 48 L. Compounds §6.2. _Risk:_ Medium. _Priority:_ P1, Small.
- **`nuxeo-api-base.ts`** — 45 L, 6 methods (`apiUrl`, `get/post/put/delete`, `nxqlSearch`).
  **The HTTP wrapper beneath every service**, with no direct test that `apiUrl` composes
  correctly. _Risk:_ **High** by blast radius, low by change frequency. _Priority:_ **P1**, Small.
- **`tag.service.ts`** — 45 L, 3 methods. _Risk:_ Low. _Priority:_ P3, Small.
- **`document.service.ts`** — 38 L, 4 methods. Dashboard "recently edited/viewed" and the expired
  queue. _Risk:_ Low. _Priority:_ P3, Small.
- **`asset-aggregation.service.ts`** — 23 L · **`clipboard-target.service.ts`** — 21 L ·
  **`search-aggregation.service.ts`** — 18 L. Thin signal holders. `clipboard-target` is the one
  with teeth: a stale paste target moves documents to the wrong folder. _Risk:_ Low–Medium.
  _Priority:_ P3, Small.

### 7.3 `AGENTS/01-services.md` is stale — a documentation defect

Found while reconciling. Recorded because the audit's own matrix would have been wrong if it had
trusted the document.

- **Four service files have no section at all:** `search.service.ts` (839 L — the largest),
  `trash.service.ts`, `asset.service.ts`, `content-model.service.ts`.
- **`SearchAggregationService` is documented with five methods it does not have.**
  `01-services.md:132-150` lists `suggest`, `getUserCollections`, `getSavedSearches`,
  `getSavedSearchById`, `saveSavedSearch`. That class is 18 lines with one method,
  `markSavedSearchDirty`. Those five live on `SearchService`, which the document never mentions.
- **Signature drift:** `DocumentDetailService` is documented with ~40 methods and has 61 (all
  five version methods, all five attachment methods, all six comment methods, `publishDocument`,
  `addACE`, `removeAcl`, `replaceACE` are absent from the doc). `TaskService`, `WorkflowService`,
  `SelectionService`, `NuxeoApiBase` and `DirectoryService` each omit methods.
- **Five entries are prose stubs with no signatures:** `PrincipalPermissionsService`,
  `AssetAggregationService`, `TrashFilterService`, `SettingsService`, `AdministrationService`.
- `AGENTS.md` §3 advertises "23 services"; `AGENTS/00-architecture.md` and §8 of `AGENTS.md`
  advertise "All 23 services with full method signatures". There are 27 service files in that
  directory. _Priority:_ **P1**, Small. This is the file every agent and new engineer reads first.

---

## 8. Cross-cutting concern coverage

- **File upload** — _covered, narrowly._ `document-import.service.spec.ts:283-302` drives
  `/upload/new/default` then `POST /upload/batch-1/0`. `create-import-dialog.component.spec.ts`
  covers staged-batch orchestration, stalled and superseded uploads — against a **mocked**
  service. **Gap:** the byte transfer itself (`uploadFileToBatch`) is never called directly; no
  test asserts the request body or headers. No E2E upload. _P1, Medium._
- **Download and blob lifecycle** — _well covered, and the best-covered cross-cutting concern._
  Renditions (`nuxeo-renditions-api.spec.ts`, incl. 404), download xpath/filename split
  (`nuxeo-download-api.spec.ts:64`), `fetchBlob`/`fetchPdfRendition`/`fetchThumbnail`/`exportZip`/
  `bulkDownload`. **Revocation on destroy is asserted, not stubbed**, in eight specs across
  document-detail, attachment preview, note image picker, search queue, search and browse.
  **Gap:** `TrashComponent.clearThumbnails()` (§6.2), and no E2E download. _P2, Small._
- **RBAC and permissions** — _mixed._ Strong on ACL read/write (`nuxeo-acl.service.spec.ts`,
  `nuxeo-acl-write.spec.ts`, which explicitly covers `sys_acl` vs `sys_effectiveAcl` so inherited
  grants are not rewritten as local), seven permission utility specs, three dialog specs, and
  component gating (`browse.permissions.spec.ts`, "refuses to trash without the Remove
  permission"). **Gap: the guards.** Only `fullAdministratorGuard` has a spec
  (`admin-route.guards.spec.ts:111`). **`authGuard`, `loginGuard`, `adminGuard` and `themingGuard`
  have no unit spec** — the entire route-level authorisation layer is unit-untested, covered only
  by one negative E2E case. Plus `principal-permissions.service.ts` (§7.2). _P0, Medium._
- **Pagination and sorting** — _partial._ Page index/size exercised in ten specs plus
  `paginated-total.spec.ts`. **Sorting is tested in exactly one place** — `search.spec.ts:525-556`
  (tri-state column sort, `sortBy`/`sortOrder` query-param round trip). No sorting test for
  browse, trash, assets or any admin table. _P2, Medium._
- **Retry, timeout, offline** — **effectively none, and the reason is structural.** There is **no
  `retry()`, `retryWhen()` or `timeout()` operator anywhere in `apps/` or `libs/`**. The only
  `retry` is a user-clicked button. Network-error (`status: 0`) handling appears twice:
  `browse.service.csv-poll.spec.ts:99` and `ai-error.spec.ts:37-38`. No offline or timeout
  behaviour is specified, so none can be tested. **This is a product gap surfacing as a test
  gap** — worth raising separately from this audit. _P1, Large._
- **Feature flags** — _consumed everywhere, tested nowhere._ `AiFeatureFlagService` has **no spec
  file**; it is stubbed in six document-detail specs. Untested: the `localStorage` opt-out read,
  and a one-time migration that **forcibly re-enables AI for users who previously opted out**. A
  regression there either resurrects the opt-out bug or re-flips every existing user's choice.
  _P1, Small._
- **i18n** — _covered, and well._ `app-translate-loader.spec.ts:20-169` covers upstream key
  aliasing, the folders < app catalogue < manifest-labels precedence, manifest override of an
  aliased key, and compiled-in English fallback on fetch failure.
  `register-locale-data.spec.ts:22-51` covers every advertised locale, fr/de formatting instead
  of NG0701, and idempotency under unordered `APP_INITIALIZER`. **Caveat:** both are in
  `apps/nuxeo-ui`, so both are invisible to coverage (§4.2). Separately, several E2E and harness
  assertions are coupled to untranslated English literals (`'Root'`, `'Create / Import'`,
  `'Username (required)'`, English month abbreviations) and will break as localisation lands.
  _P2, Medium._
- **Extension manifest Layer 0 / Layer 1** — _the best-covered area in the repository._ Four
  `app-config` specs and ten `extensions` specs, including error paths, a manifest patching a
  packaged id, route path validation, and rule nesting. Plus three app-level wiring specs.
  **Gap:** `nav-items.spec.ts` tests **only** Administration gating; the other 14 packaged nav
  entries — including `app.navbar.trash` — have no test that they render, route or order
  correctly. And no E2E asserts a manifest change alters runtime behaviour, which is the Beta's
  headline customer-facing claim. _P1, Medium._
- **Authentication** — _strong at unit level._ `auth.service.spec.ts` covers persisted-session
  restore, basic-auth hydration with `/me` 403, stale-cookie mismatch, share-token auth and
  failure, and logout clearing selection and browse context — with **real** `SelectionService`,
  `BrowseContextService` and `ClipboardTargetService`, making it the closest thing in the repo to
  an integration test. `nuxeo-auth.interceptor.spec.ts` covers the 401/403 matrix, `withCredentials`,
  the `/nuxeo/logout` query-string false positive and cross-origin skip.
  `session-timeout.service.spec.ts` covers idle logout, activity reset and re-arming.
  **Gaps:** the guards (above); no E2E ever submits the login form or clicks sign-out; session
  timeout has no E2E (its only coverage was `session-timeout.mjs`, which is broken — §4.6).
  _P1, Medium._
- **Multi-select and bulk actions** — _partial._ `selection.service.spec.ts` covers 4 of 10
  methods (§7.1); the topbar slot is covered. **`apps/nuxeo-ui/src/app/extensions/bulk-action.services.ts`
  has no spec** — all six handlers registered at `provide-app-extensions.ts:110-118`
  (`downloadZip`, `addToCollection`, `compare`, `addToClipboard`, `publish`, `delete`) are
  untested, including the bulk trash confirmation. _P1, Medium._

---

## 9. Test quality assessment

Assessed against `AGENTS/05-test-standards.md`. Every claim below was verified against source.

### 9.1 Assertions that cannot fail

The repository's documented failure mode, found in both tiers.

**E2E — the three most serious:**

1. **`expectSurfaceWithData(page, 'lib-browse', 'Root')`** at `browse.spec.ts:15`, `:23` and
   `cross-browser.spec.ts:87`, `:135`, `:142`. `fixtures.ts:61-64` documents the helper as the
   thing that distinguishes rendering from working: "_every critical-path spec asserts a piece of
   **repository data**, which can only be there if the XHR was authenticated and Nuxeo
   answered._" **`'Root'` is not repository data.** `browse.ts:562` pushes
   `{ label: 'Root', href: '/browse' }` unconditionally, _before_ the `if (!doc …) return crumbs`
   on the next line, and `showBreadcrumbs()` returns `true` when there is no document. Verified
   first-hand. An empty page, a dead Nuxeo or a 403 on every XHR all satisfy it. Five of the
   helper's six `lib-browse` call sites are affected; the sixth
   (`document-detail.spec.ts:59`, passing a UID-specific title fetched from the API) is the
   correct use and shows what the others should look like.
2. **Both `?q=` search specs exercise nothing.** `search.spec.ts:26` and `:40` navigate to
   `/#/search?q=…`. Verified against `search.ts:250-306`: `params` supplies only `quickFilters`,
   `sortBy` and `sortOrder`; `q` comes from `drawerFilters`, a signal on
   `SearchAggregationService` written **only** by `search-filters-drawer.component.ts:843` and
   reset at `search.ts:938`. Nothing syncs the URL into it — confirmed by grepping every
   `drawerFilters` reference outside the search component. So both tests load the identical
   default unfiltered search. The second of them, `search.spec.ts:33`, is documented at `:34-39`
   as "_the regression guard for the HXQL injection fixed in `hxql-literal.ts`_". **It cannot
   fail if that security fix is reverted.** This is the single most serious individual finding:
   a non-functional guard is worse than no guard, because it occupies the slot where a real one
   would go.
3. **The quote round-trip types into the wrong element.** `cross-browser.spec.ts:199` selects
   `page.locator('input[type="text"], input[type="search"]').first()` page-wide. The first such
   element in DOM order is the app-shell global search box
   (`app-shell.component.html:59`), which precedes the router outlet and has no Enter handler. So
   `input.press('Enter')` at `:206` is a no-op, and the assertions at `:204` and `:210` are the
   same `toHaveValue(term)` with a `waitForTimeout` between them. There is no round trip.

**E2E — also weak:** `auth.spec.ts:63` matches _any_ button on the page via
`'button, input[type="submit"]'` + `.first()`, while `:66` and `:100` in the same file use the
correct `button.login-submit`. `auth.spec.ts:148` is a negative URL match, so breaking the app
entirely makes it greener. `document-detail.spec.ts:84` is `not.toContainText` on a locator that
may match zero elements — which passes in Playwright — so it is satisfied by the component never
mounting. `document-detail.spec.ts:72-74` asserts the strings `Permissions`/`History`/`Publishing`
appear anywhere in the host, and those words appear throughout the template as section headings;
the tabs are manifest-driven and the tab strip could be empty with the test still green.

**In-process — 1.6% of assertions (91 of 5,780) are bare `toBeTruthy()`/`toBeDefined()`, which is
low. The ones that exist cluster:**

- `session-timeout.service.spec.ts:57` — titled "starts idle tracking when authenticated"; the
  body asserts `expect(service).toBeTruthy()` on something `TestBed.inject()` returned three
  lines earlier, plus a negative that would also hold if `start()` were `return;`.
- `collection-detail.spec.ts:1165` — `expect(component.avatarColor).toBeDefined()` and
  `expect(typeof …).toBe('function')`. A class method is always both; this restates the compiler.
- `collection-detail.spec.ts:380` — "should return icon for document type" asserts a truthy
  string, never that it is the right icon.
- `providers.spec.ts:132-153` — `expect(tokens).toHaveLength(12)` against an array literal written
  two lines above, commented as guarding against a dropped port. Dropping a port from the
  _production_ provider array does not change it. The `TestBed.inject` loop beside it is the
  load-bearing half.
- `providers.spec.ts:168-191` — `expect(exported).toBeDefined()` over static ES imports; a missing
  one fails module resolution before `it` runs.
- `nuxeo-download-api.spec.ts:110,130,162,173` and `nuxeo-document-api.spec.ts:342,351,360` —
  `rejects.toBeDefined()`, which cannot distinguish a 404 from a `TypeError`.
- `note-editor.spec.ts:521` — `expect(() => quill.headerHandler?.('2')).not.toThrow()` as the only
  assertion; the optional chain means it also passes if the handler was never wired.
- Ten `it('should create')` smoke tests, six of which run against a stubbed template
  (`set: { imports: [], template: '<div></div>' }`) so they do not even prove the template
  compiles. `core.spec.ts` and `ui.spec.ts` are Nx scaffolding whose only test is that.

### 9.2 `httpMock.verify()` discipline

42 specs use `HttpTestingController`; 40 call `.verify()`.

- **Two do not:** `document-detail.tabs.spec.ts` and `document-detail.viewer.spec.ts`. The viewer
  spec would _fail_ if `verify()` were added — its storyboard tests deliberately leave a `Subject`
  pending. The tabs spec is worse in one respect: it mounts a 15-provider component and makes
  only two `expectOne` calls in ~2,000 lines, so essentially its entire HTTP surface is
  unasserted and any unanticipated request is silently swallowed.
- **Two of the 40 are tautologies**, verified first-hand:
  `provide-app-extensions.spec.ts:57-60` and `app-shell-header-a11y.spec.ts:193-194` both do
  `http.match(() => true).forEach(r => r.flush(…))` and _then_ `http.verify()`. Flushing every
  outstanding request and verifying the queue is empty cannot report anything. That is cleanup
  spelled `verify()`, and it reads as a check. (`nuxeo-model-api.spec.ts:212` uses the same
  `match(() => true)` shape but correctly and with a comment explaining why — draining requests
  `forkJoin` cancelled so `verify()` stays meaningful. Not a finding.)
- **One is per-`it` rather than `afterEach`:** `drive-dialog.spec.ts`, 7 `it`s and 7 `verify()`s.
  Complete today, but an earlier `expect` failure short-circuits it, and the eighth test someone
  adds will not have it.

### 9.3 Error-path coverage

The standard requires a 4xx/5xx test per service method. Actual, by spec:

- **Zero error paths:** `arender.service.spec.ts` (0/22 tests), `directory.service.spec.ts`
  (0/13), `user.service.spec.ts` (0/10), `trash.service.spec.ts` (0/7),
  `browse-context.service.spec.ts` (0/4), `settings.service.spec.ts` (0/3),
  `selection.service.spec.ts` (0/5 — pure signal state, arguably exempt).
- **Thin:** `administration.service.spec.ts` 1/5, `content-lake-ingest.service.spec.ts` 1/16.
- **Good:** `document-detail.service.operations.spec.ts` 25/81,
  `settings.service.accounts.spec.ts` 14/27, `user.service.crud.spec.ts` 11/26,
  `browse.service.export.spec.ts` 11/20.
- **Misleading:** `browse.service.spec.ts` shows 7 error markers, none of which test a _failing_
  call (§7.1).

### 9.4 Mock fidelity

The strongest dimension, and deliberately so. `browse.spec.ts:49-61` and `search.spec.ts:52-56`
bind mock return types to the real service:
`getByPath: vi.fn((): ReturnType<BrowseService['getByPath']> => notConnected())`, with the
rationale recorded — "_a fixture that has drifted from what `BrowseService` actually returns
fails to compile rather than passing against a shape the production code would never receive_"
— and the trap named: "_Neither shows up under `nx test`, which strips types through esbuild._"

**What it does not protect:** method _existence_ and parameter lists. `{ provide: BrowseService,
useValue: mockBrowseService }` is not type-checked by Angular DI, so a renamed method leaves the
mock's old key in place, the spec compiles, and production fails at runtime. And
`document-detail.tabs.spec.ts:154-185` declares a 30-method mock with **no** `ReturnType<>`
binding at all — hand-written shapes like `Observable<{ entries: unknown[] }>`. If the service
starts returning `{ entries, totalSize }` and the component reads `totalSize`, the test passes
with `undefined`. A sibling spec in the same feature does it correctly; this one does not.

### 9.5 Over-mocking

30 specs replace the component template outright. The reason is real and documented
(`browse.spec.ts:151-153`: zone.js-tracked handles from 20+ imported modules hang the test
process under Node 20 in CI), so this is a trade, not an oversight — but it means those specs
test the class, not the component, and their `it('should create')` proves nothing.

Across the suite, **326 bare `toHaveBeenCalled()` against 447 `toHaveBeenCalledWith(...)`**,
concentrated in `browse.actions.spec.ts` (41), `document-detail.tabs.spec.ts` (27),
`collection-detail.spec.ts` (26), `search.spec.ts` (21). Representative:
`document-detail.tabs.spec.ts:473-482` asserts `lastDialogData()` and
`getDocumentPermissions` was called — both "the component called the mock" — while never
asserting the permissions appear in `localAces()`. A test 36 lines above _does_ assert resulting
signal state, and survives a refactor of how the reload is triggered; this one does not.

### 9.6 Integration character

Closest to genuine integration, in order:

1. **`apps/nuxeo-ui/src/app/auth/auth.service.spec.ts:209-245`** — injects the _real_
   `SelectionService`, `BrowseContextService` and `ClipboardTargetService` and asserts a
   cross-service invariant after `logout()`. The only spec in the repository that asserts a
   multi-service invariant with nothing stubbed.
2. **`nuxeo-document-api.spec.ts`** — real `NuxeoAclService` and `NuxeoPrincipalResolver`; the
   ACL rollback tests drive four sequential HTTP round trips through real collaborator code.
3. **`browse.service.spec.ts`** — multi-hop fallback chains (`/path/` 403 → domain NXQL →
   tree_children → nav-node NXQL) entirely through real service code.
4. **`providers.spec.ts`** — an integration test of the DI graph itself.

At the other extreme: every `nuxeo-client/utils/*.spec.ts` (pure functions, no TestBed). The 30
template-stubbed component specs sit in an awkward middle — TestBed's cost without its benefit.

**What distinguishes the good ones is that a real object graph produces the value under
assertion**, so a refactor that moves logic between collaborators still passes if behaviour is
preserved. That is the property the missing tier should generalise (§11).

### 9.7 DOM vs signal testing

31 specs query the DOM against a standard that says not to. **Mostly this does not matter, and
in two cases the standard is wrong**: the a11y specs _must_ read the DOM, and
`app-shell-header-a11y.spec.ts:219-221` uses `toBeTruthy()` precisely as a guard against the
following assertions passing vacuously — a legitimate use, and not counted in §9.1. Where it does
matter: `login-page.component.spec.ts` (46 DOM references, e.g. asserting
`input[formcontrolname="username"]` exists) and `note-editor.spec.ts` (20, mostly CSS-class
presence) use DOM queries as a substitute for state assertions.

### 9.8 Test data

**There is no shared fixture or factory module anywhere in the source tree.**

- **41 spec files define their own `doc()`/`nuxeoDoc()`/`docWith()` factory.** Three of them —
  `browse.spec.ts:38-47`, `document-detail.tabs.spec.ts:59-71`, `nuxeo-document-api.spec.ts:55-63`
  — are near-identical `NuxeoDocument` builders with different defaults.
- **50 spec files contain raw inline document literals with no factory.** `browse.spec.ts` alone
  has ~15.
- Three separate `ace()` builders exist.

Roughly half the suite duplicates fixtures inline and the other half duplicates the factory that
builds them. The authors knew the cost — `nuxeo-document-api.spec.ts:39-41` records that "_every
optional-looking field on `NuxeoAce` is in fact required, so a partial literal only compiles
behind a cast — which is what hid an incomplete fixture here_" — but the lesson was learned
per-file and never extracted. This is the root cause of §9.4's residual drift risk.

### 9.9 Flakiness risk (none observed, nine specs at risk)

Zero flaky verdicts across the full Vitest suite and three runs per Playwright engine. The risk
is latent:

- **`provide-manifest-refresh.spec.ts:128`** (deleted with the refresh in NXSAT-312) — a real `setTimeout(resolve, 2600)` wall-clock sleep
  waiting on 2,000 ms of production backoff. A 600 ms margin on a loaded runner. The sibling at
  `:140` sleeps 1,200 ms. **This is in `apps/nuxeo-ui`, where `fakeAsync`/`tick` is available and
  already used** in `session-timeout.service.spec.ts:64` — so it is an inconsistency, not a
  constraint.
- **`browse.actions.spec.ts:788,800,812`** — three `setTimeout(resolve, 400)` sleeps on a
  tag-search debounce.
- **`collection-detail.spec.ts`** — six 10 ms sleeps; `create-import-dialog.component.spec.ts:193`
  — one 30 ms sleep.
- **`document-detail.tabs.spec.ts:1229,1253-1267`** — seven relative-time boundary assertions off
  the real `Date.now()`, including `expect(ago(60_000)).toBe('1 minute ago')` sitting exactly on
  a boundary. `browse.state.spec.ts` uses fake timers for the same thing; this does not.
- Six `setTimeout(resolve, 0)` microtask flushes — lower risk, but order-dependent.
- **Playwright:** seven `waitForTimeout` calls totalling ~10 s of hard waits, combined with
  `retries: 1` locally, which would absorb timing failures on a developer machine.

### 9.10 Misleading test names

Beyond §9.1: `providers.spec.ts:101` — "creates a SECOND instance per port, because the token uses
useClass not useExisting" — is a test that **asserts a defect is present** and will fail when the
defect is fixed. Its comment says `// DEFECT (reported, not changed)`. Defensible as
documentation, but a correct fix breaks the suite, which is a maintenance trap. And the
flush-then-verify `afterEach` blocks in §9.2 are the same category at block level: named
`verify()`, incapable of verifying.

### 9.11 Defects found in the beta-harness itself

The harness is well designed — `h.check()` never throws so one failure cannot hide the rest,
`h.note()` exists specifically to replace the `check(name, true)` anti-pattern, `phase-runner.mjs`
treats zero checks as a failure and injects a synthetic screenshot-audit step that hashes every
image. Four defects nonetheless:

- **`phase-0-no-backend.mjs:58`** asserts the login label is `'Username or email'`. The app
  renders `Username (required)`. `expectText` does `actual.includes(expected)`, so **this check
  fails today** — invisible because the step only runs when no Nuxeo is reachable, and nothing
  runs it.
- **`phase-3-search.mjs:46`** hardcoded the default Docker credential pair (§5.4, since removed).
- **`assertion-audit.mjs:59`** — `PAGE_ASSERTIONS` omits `expectNoA11yViolations`, so
  `phase-6-a11y.mjs`'s 9 a11y assertions are not counted and a step whose only assertion is an
  a11y scan would be falsely flagged `screenshot-without-assertion`.
- **`assertion-audit.mjs:349`** targets `scripts/collect-evidence/steps/`, **a directory that does
  not exist**. The real evidence scripts are `scripts/collect-evidence/NXSAT-*.mjs` — 25 files,
  directly in the parent. `existsSync` skips the missing directory silently, so the audit reports
  a clean pass over 13 files while 25 comparable files go unchecked. This is a gate that is green
  because it is looking in the wrong place — the exact pattern `CLAUDE.md` warns about.

### 9.12 Phase 5 verification

- **Passed.** Every dimension in the plan is addressed. Every load-bearing claim was
  independently confirmed against source before being recorded: the `'Root'` breadcrumb
  (`browse.ts:558-566`), the `q`-from-signal path (`search.ts:237-306` plus an exhaustive
  `drawerFilters` reference search), the shell search input ordering
  (`app-shell.component.html:57-65`), the two flush-then-verify blocks, the 15 spec-less
  services, and the 13 harness steps. Three claims from the analysis subagents were **corrected**
  by that check: the harness step count (13, not 14), the spec-less service count (15, not 14),
  and `nuxeo-model-api.spec.ts:212`, which uses the `match(() => true)` shape correctly and is
  not a finding.
- **Gap:** §9.3's error-path figures are per-spec counts of `status: 4xx|5xx`/`throwError`
  markers, not a per-method audit; `browse.service.spec.ts` shows why that heuristic can mislead
  and it was manually corrected there. Other specs were not manually re-checked to the same
  depth. Labelled as an assumption in §14.

---

## 10. Quick wins and architectural changes

### 10.1 Quick wins — Small effort, disproportionate value

- **QW1 (P0, Small).** Fix or scope the two WebKit failures so `nx run nuxeo-ui-e2e:e2e` is green
  again, and record which of the two readings in §5.1 the team took. A red suite nobody runs
  becomes a suite nobody ever wires into CI.
- **QW2 (P0, Small).** Make `expectSurfaceWithData` incapable of being passed a constant. Change
  the signature so the expected text must come from an API-discovered value — the
  `document-detail.spec.ts:54` pattern — and fix the five `'Root'` call sites. _Trade-off:_ each
  browse spec needs a cheap NXQL round trip in a fixture, adding ~200 ms per spec.
- **QW3 (P0, Small).** Make the `?q=` specs exercise the real path by driving the filters drawer
  instead of the URL, **or** — better, and worth a separate ticket — make the search component
  read `q` from the URL, which is what a user sharing a search link would expect and is arguably
  the real defect here.
- **QW4 (P0, Small).** Add a `test` target to `libs/features/trash/project.json`. One line. It
  unblocks every other trash recommendation and today makes writing a trash spec pointless.
- **QW5 (P1, Small).** Remove `--coverage` incompatibility: either give `nuxeo-ui` a
  `karma-coverage` reporter and accept the flag, or exclude it explicitly from the run-many in
  `sonarcloud.yml`. Today the command fails silently on every PR. _Trade-off:_ the honest fix is
  QW6, of which this is the interim.
- **QW6 (P1, Small).** Delete the two flush-then-verify `afterEach` bodies or rename them to
  `drainPendingRequests()`. As written, two files read as having HTTP verification and have none.
- **QW7 (P1, Small).** Add `afterEach(() => http.verify())` to `document-detail.tabs.spec.ts`. It
  will go red immediately — that is the point. Do this one before `viewer.spec.ts`, which needs
  per-test drains because its storyboard tests intentionally leave a `Subject` pending.
- **QW8 (P1, Small).** Fix `assertion-audit.mjs:349` to point at `scripts/collect-evidence/` and
  add `expectNoA11yViolations` to `PAGE_ASSERTIONS`. A CI-gated audit that scans an empty
  directory is worse than none, because it reports a pass.
- **QW9 (P1, Small).** Move `phase-3-search.mjs:45-46` onto `process.env` and fix
  `phase-0-no-backend.mjs:58`'s stale label.
- **QW10 (P1, Small).** Reconcile `AGENTS/01-services.md` with disk (§7.3) and correct the "23
  services" claim in `AGENTS.md`. Also record in `AGENTS/05-test-standards.md` and `CLAUDE.md`
  that `apps/nuxeo-ui` runs Karma, not Vitest.
- **QW11 (P2, Small).** Replace the six real sleeps in `provide-manifest-refresh.spec.ts` (since deleted) and
  `browse.actions.spec.ts` with `fakeAsync`/`tick`, and wrap
  `document-detail.tabs.spec.ts:1223-1268` in `vi.useFakeTimers()` with a fixed system time.
  Removes ~5 s of wall clock and the two most load-sensitive tests.
- **QW12 (P2, Small).** Automate the bogus-credentials sensitivity run.
  `cross-browser.spec.ts:49-52` records that running the suite under bad credentials caught two
  vacuous specs. **That negative control exists only as a comment.** A script that runs the suite
  with `NUXEO_PASS=wrong` and asserts that at least N specs fail is the single cheapest guard
  against the §9.1 class of defect recurring — and finding §9.1.1 proves one already has.

### 10.2 Architectural changes

- **AC1 — Build the integration tier (§11).** _Trade-off:_ a new tier needs a live Nuxeo, which
  is the reason none exists. The mitigation is the two-track design in §11.1.
- **AC2 — Extract `libs/shared/testing` with typed factories.** _Trade-off:_ it is a coupling
  point, and `eslint.config.mjs`'s `depConstraints` need a `type:testing` tag every project may
  depend on, which weakens the boundary the constraints exist to enforce. There is also a real
  risk of a god-object with 40 optional overrides, at which point it is harder to read than the
  inline literals. Mitigate by keeping one factory per model and requiring every field to be
  filled — the `nuxeo-document-api.spec.ts:39-41` discipline — with no `Partial<>` escape hatch.
- **AC3 — Move `apps/nuxeo-ui` to Vitest.** Ends the two-runner split, the invisible-coverage
  problem and the Jasmine-matcher island in one move. _Trade-off: the migration is not free, and
  the hard part is specific._ Karma runs in real Chrome, so
  `app-shell-header-a11y.spec.ts`'s focusability census (`element.focus()`, `document.activeElement`,
  reasoning about `display:none` above 675 px) and `login-page.component.spec.ts`'s 46 DOM
  assertions depend on real layout and focus semantics that jsdom models weakly. Expect to keep a
  small Playwright-component-test island for the a11y specs or accept weaker coverage there. The
  auth specs would port in an afternoon; the a11y specs are the risk.
- **AC4 — Typecheck spec files, and gate per-service coverage rather than per-project.** Three
  separate spec comments independently record that Vitest strips types through esbuild so a
  type-broken spec stays green; `CLAUDE.md` names it as one of two traps that cost a phase. The
  mitigation so far is per-file discipline three authors reinvented. _Trade-off:_ a per-service
  gate blocks PRs on pre-existing debt — 15 spec-less services is weeks of work. The honest
  sequencing is to ratchet: record today's per-service state as the floor, fail only on
  regression, and burn down on a schedule. A gate everyone routes around is worse than no gate,
  and this repository has already shipped one that matched names but not versions.

---

## 11. Implementation scope — the missing tier in nine stages

### 11.1 The central decision: real Nuxeo, or contract tests against fixtures?

**Recommendation: both, in that order — a real-Nuxeo service-level suite as the primary tier, with
recorded fixtures generated _from_ it as a fast per-PR subset.** Argued rather than asserted:

- **Real-Nuxeo only** catches what matters — actual response shapes, enrichers, error envelopes,
  NXQL the server accepts, permission semantics. But it cannot run on a GitHub-hosted runner
  today. `a11y.yml`'s trailing comment sets out exactly why, and the reasoning transfers without
  modification: `backend-preflight.mjs` says in as many words "_this repo has no compose file, so
  the stack was created by hand and cannot be recreated_", it can only `docker start` an existing
  container, and Nuxeo images come from the private `packages.nuxeo.com` for which this repository
  holds no credentials. A tier that can only run on one developer's machine gets bypassed and
  then ignored — `coverage-gate.mjs` says so in its own header.
- **Fixtures only** runs anywhere and is fast, but it tests our _belief_ about Nuxeo's responses.
  When the server changes, the fixtures do not, and the suite stays green while production
  breaks. That is the same failure class as §9.1, one level up.
- **Both, with fixtures _recorded from_ the real suite**, resolves the tension: the recorded
  tier runs per-PR on any runner; the real tier runs nightly and, when a recorded response no
  longer matches the server, **fails the recording, not the test** — so drift surfaces as a
  specific, actionable diff rather than as silent staleness.

The reusable foundations already exist and should not be reinvented: `e2e-preflight.mjs`'s
exit-2 precondition convention, the port and data-root isolation in
`.cursor/skills/fix-bug/scripts/new-ticket-workspace.sh`, and `phase-runner.mjs`'s
"zero checks is not a pass" rule.

### 11.2 The nine stages

Each has an objective, scope, effort, risks, acceptance criteria and a verification command.
Dependencies are stated; stages 1–3 are prerequisites for everything after.

**Stage 1 — Unblock measurement.** _P0, Small._ Add the `test` target to `trash` (QW4); fix the
`--coverage` failure (QW5); add `assets`, `shared-ai-client`, `tasks` to the ratchet baseline and
clear the 5 stale allowlist entries so `beta:coverage` is green and meaningful.
_Acceptance:_ `npm run beta:coverage` exits 0; `nx run-many -t test --coverage` exits 0;
`nx show projects --with-target test` returns 21. _Verify:_ those three commands.
_Risk:_ low. _Depends on:_ nothing.

**Stage 2 — Stop the bleeding in the existing tiers.** _P0, Medium._ QW1, QW2, QW3, QW6, QW7,
QW8, QW9, QW12. _Acceptance:_ `nx run nuxeo-ui-e2e:e2e` exits 0 on both engines; the
bogus-credentials control fails ≥5 specs; `beta:audit` scans 25 additional files and is still
green. _Verify:_ `npx nx run nuxeo-ui-e2e:e2e`, the new control script, `npm run beta:audit`.
_Risk:_ QW1 may surface a genuine a11y defect requiring a product change (§14.3).

**Stage 3 — `libs/shared/testing`.** _P1, Medium._ AC2. Typed factories for `NuxeoDocument`,
`NuxeoAce`, `NuxeoComment`, audit entry, result page; the `scope:shared`/`type:testing` tags and
the `depConstraints` edge. Migrate the three duplicate document builders first as proof.
_Acceptance:_ three specs migrated with no behaviour change; a deliberate field-type change in the
model breaks compilation in exactly one file. _Verify:_ `nx affected -t typecheck`, plus that
negative control run by hand. _Depends on:_ Stage 1.

**Stage 4 — Integration harness and the precondition contract.** _P1, Medium._ A new
`libs/integration-tests` project with its own target, reusing `e2e-preflight`'s exit-2 convention:
refuse to run against an absent or empty Nuxeo, and **refuse to run against the default
credentials without an explicit opt-in flag**, closing §5.4. Per-run data root under
`/default-domain/workspaces/it-<runid>` with guaranteed teardown, so the fixture leak in §4.6
cannot recur. _Acceptance:_ the harness exits 2 with a specific message for each of: no Nuxeo,
empty Nuxeo, missing credentials; and a run that creates documents leaves none behind.
_Verify:_ four deliberate negative controls. _Depends on:_ Stage 3.

**Stage 5 — Search and query contract.** _P0, Large._ The highest-risk gap (§6.1, §7.2).
`SearchService` (839 L) and `nuxeo-api-base.ts` against live Nuxeo and OpenSearch: NXQL and HXQL
generation including the injection cases `hxql-literal.ts` guards, quick filters, drawer filters,
sorting, pagination, saved-search CRUD, the document picker, empty and error results.
_Acceptance:_ every public method of both services exercised against the server, including at
least one 4xx and one 5xx; reverting the `hxql-literal` fix turns the suite red. _Verify:_ that
revert, run as a negative control. _Risk:_ index staleness — the harness must assert index
freshness, not just repository content.

**Stage 6 — Write paths and destructive operations.** _P0, Large._ Upload
(`uploadFileToBatch` end to end), download, trash/restore/permanent-delete,
`SelectionService.deleteSelected`, bulk actions. Every case creates its own fixture and tears it
down. _Acceptance:_ each operation verified by a follow-up API query, not by a UI assertion.
_Verify:_ the suite plus a leak check that the data root is empty afterwards.

**Stage 7 — RBAC and the guards.** _P1, Large._ `authGuard`, `loginGuard`, `adminGuard`,
`themingGuard` unit specs (§8), plus integration for `principal-permissions.service.ts`, ACL
read/write against real inherited-vs-local ACLs, and **a non-administrator fixture user** — the
one missing ingredient that makes every permission branch currently untestable, since
`fixtures.ts` hardcodes `isAdministrator` and `groups: []`.
_Acceptance:_ every guard has a redirect test; at least one test runs as a non-admin and is
denied. _Risk:_ creating and cleaning up a Nuxeo user per run.

**Stage 8 — Feature-level workflows.** _P1, Large._ Collections membership, document-detail write
paths (versions, publish, ACL), notes, CSV export, and the trash component (§6.2). Plus the
`AiFeatureFlagService` opt-out and its one-time migration (§8).

**Stage 9 — Fold in the orphans and the harness.** _P2, Medium._ Per §13: promote
`session-timeout.mjs` and `clipboard-move-scenarios.mjs`, convert `note-document-scenarios.mjs`,
delete the other two. Bring the 13 evidence steps under a scheduled run so §4.7 stops being an
unexecuted tier, and execute them as part of this stage's acceptance.

---

## 12. CI/CD and quality-gate plan

### 12.1 What blocks a PR

Add to `ci.yml`'s existing `lint-build-test` job — cheap, deterministic, no Nuxeo:

- **`npm run beta:coverage`** — after Stage 1 makes it green. It is the ratchet the repository
  already built and the only thing that stops coverage rotting; it currently runs nowhere.
  _P0, Small._
- **The recorded-fixture integration subset** (§11.1) once Stage 5 exists. Target under 3 minutes.
  _P1, Medium._
- **The typecheck-specs gate** (AC4). _P1, Small._
- **Not Playwright.** It needs a live Nuxeo and a served app. Forcing it into the per-PR gate
  makes the gate red on every machine without the Docker stack, and `coverage-gate.mjs` already
  records what happens then: "_a gate that cannot pass gets bypassed and then ignored. That is
  worse than no gate._"

### 12.2 What runs nightly

**This half defers to [NXSAT-231](https://hyland.atlassian.net/browse/NXSAT-231), which already
specifies a nightly job on both engines against a Nuxeo service container, visible failure
reporting, published artifacts, a deliberately-broken-spec check, and keeping Playwright on
`--no-save`. This audit does not restate it. It contributes three things NXSAT-231 leaves open:**

1. **Sizing, measured rather than assumed.** Chromium 19 cases in **52 s**; WebKit 19 in **97 s**;
   both engines serially in **165 s**. Add a Nuxeo service container cold start and `npm ci`, and
   a nightly job is roughly **12–15 minutes**. That is comfortably nightly-affordable and,
   notably, **also affordable per-PR** if a service container can be stood up at all — which is
   the real constraint, not wall clock.
2. **The per-PR subset decision NXSAT-231 leaves open.** _Recommendation: do not take a subset of
   the Playwright suite per-PR._ At 165 s for the whole thing, a subset saves nothing worth the
   cost of maintaining a tag taxonomy and the risk of the untagged half rotting. Either the
   service container works — in which case run all 38 — or it does not, in which case run none.
   The per-PR fast tier should be the recorded-fixture integration subset (§12.1), which needs no
   container at all.
3. **The evidence this audit produced that sizes NXSAT-231's own acceptance criterion.** Its
   criterion is "_a deliberately broken spec has been observed to turn the job red_". **Two specs
   are already broken on WebKit** (§5.1), so that criterion can be met with a real regression
   rather than a synthetic one — and the job's first run will be red, which is the correct
   outcome and should be expected rather than treated as a wiring failure.

Also nightly: **the 13 beta-harness evidence steps** (§4.7), and the **live-server axe scan** that
`a11y.yml` documents as deferred — all three need the same service container, so they should share
one workflow rather than three.

### 12.3 The container problem, stated plainly

Everything in §12.2 depends on one unresolved prerequisite, and it is not a scheduling question.
Per `a11y.yml:96-129` and `backend-preflight.mjs`: there is **no compose file**, the stack was
created by hand and cannot be recreated, and Nuxeo images come from the private
`packages.nuxeo.com` for which this repository holds no credentials. **One of two things must
happen first**, and neither is in this audit's scope:

- a self-hosted runner carrying the `nuxeo` container, targeted with `EVIDENCE_ENSURE_BACKEND=1`
  and `AGENTIC_UI_EVIDENCE_DIR` pointed inside the workspace; **or**
- `packages.nuxeo.com` credentials as repository secrets, plus a compose file for Nuxeo and
  OpenSearch.

Writing a nightly workflow before one exists would ship a job that has never been observed to
pass — the exact self-confirming-gate shape this repository has been caught by. **This is the
single highest-leverage decision in the roadmap** and is item 1 in §14.3.

### 12.4 Artifacts, flake detection and reporting

- **Artifacts already exist** and need only uploading: `trace`, `video` and `screenshot` are all
  `retain-on-failure`/`only-on-failure`, writing to `dist/e2e/artifacts`. The JSON reporter writes
  `dist/e2e/results.json`. No config change needed.
- **Flake detection.** `retries: 2` in CI already surfaces retry-passes as `flaky` in the summary.
  Parse `results.json` for `status: 'flaky'` and fail the job on any — this repository's history
  argues against absorbing them. Baseline from this audit: **zero flaky across six runs**, so any
  flake in the first nightly runs is new and attributable.
- **`workers: 1` should be revisited, but not yet.** Its stated justification —
  "_these share one Nuxeo repository, and parallel specs that create or trash documents would
  interfere_" — describes a hazard the suite does not have, since no spec writes anything. But
  Stage 6 introduces exactly that hazard deliberately. **Leave `workers: 1` and re-examine after
  Stage 6**, when per-run data-root isolation (Stage 4) makes parallelism safe.
- **Reporting.** NXSAT-231 already requires failures to reach somewhere a person sees. Adding the
  per-engine split to that report matters: a merged verdict would have hidden §5.1 as "2 of 38
  failed" rather than "WebKit is broken".

---

## 13. Prioritised roadmap

Priorities weigh blast radius, whether the gap is currently invisible, and change frequency.
Change frequency was measured over the last 300 commits: `libs/shared/nuxeo-client` 45 touches,
`apps/nuxeo-ui` 44, `document-detail` 26, `tasks` 16, `ui` 12, `search` 12, `browse` 6,
`trash` 5. Defect history is a proxy — 206 of the last 400 commit subjects begin `fix`. **These
inputs are judgement applied to evidence, not measurements of defect density**, and the
priorities they produce are labelled as such in §14.

### P0 — before Beta

- **R1. Make `nx run nuxeo-ui-e2e:e2e` green.** Stage 2 / QW1. _Small._ _Acceptance:_ exit 0 on
  both engines, and the chosen resolution (product fix vs engine-scoped assertion) recorded in
  the spec.
- **R2. Repair the assertions that cannot fail.** QW2, QW3, QW12. _Medium._ _Acceptance:_
  reverting the `hxql-literal` fix turns the suite red; the bogus-credentials control fails ≥5
  specs; no `expectSurfaceWithData` call site passes a constant.
- **R3. Give `trash` a test target and cover restore/permanent-delete.** QW4 + Stage 6.
  _Large._ _Acceptance:_ `nx test trash` runs; both destructive operations covered at service and
  component level; the blob-URL ordering in `clearThumbnails()` has a regression test.
- **R4. Test `SearchService` and `nuxeo-api-base.ts`.** Stage 5. _Large._ _Acceptance:_ every
  public method exercised, with 4xx and 5xx paths.
- **R5. Fix `--coverage` and green the ratchet, then run it in CI.** Stage 1 + §12.1. _Small._
  _Acceptance:_ `beta:coverage` exits 0 locally and blocks a PR that regresses a project.
- **R6. Decide the CI container route.** §12.3. _Medium_ to decide, _Large_ to implement.
  _Acceptance:_ a documented decision, and a nightly job observed to run green once.

### P1 — before GA

- **R7. Build Stages 3, 4, 6, 7.** _Very Large_ in aggregate. The integration tier itself.
- **R8. Unit-test the four route guards.** §8. _Medium._ The whole route-authorisation layer.
- **R9. Cover `principal-permissions.service.ts`, `selection.service.deleteSelected`,
  `uploadFileToBatch`, `bulk-action.services.ts`, `AiFeatureFlagService`.** _Medium._ Five
  targeted gaps with real blast radius.
- **R10. Fix the harness defects.** QW8, QW9. _Small._ `assertion-audit.mjs` scanning a
  non-existent directory is a green gate looking in the wrong place.
- **R11. Make credential dependence explicit.** §5.4. _Small._ Keep the `Administrator` default
  for local convenience but have the preflight _warn_ when the default is in use and _fail_ when
  an explicit `IT_REQUIRE_EXPLICIT_CREDENTIALS=1` is set, as CI would.
- **R12. Reconcile `AGENTS/01-services.md` and document the Karma runner.** QW10. _Small._
- **R13. Extract `libs/shared/testing`.** AC2. _Medium._

### P2 — next quarter

- **R14. `apps/nuxeo-ui` to Vitest.** AC3. _Large._ _Trade-off in §10.2._
- **R15. Typecheck specs; ratchet per-service coverage.** AC4. _Medium._
- **R16. E2E coverage for the four uncovered routes** — collections, tasks, documents, trash.
  _Large._
- **R17. Stage 9 — resolve the orphans and schedule the harness.** _Medium._ Per script:
  _promote_ `session-timeout.mjs` (the only asserting coverage of idle-session expiry anywhere,
  and its assertions are already hard failures); _promote_ `clipboard-move-scenarios.mjs` **with
  teardown added and its `PARTIAL` status changed to `FAIL`** (real UI-plus-API verification of a
  refresh bug nothing else covers, but it leaks fixtures — demonstrated in §4.6 — and its
  headline check is decorative); _convert_ `note-document-scenarios.mjs` to a beta-harness step
  (it is an evidence capture reimplementing `phase-runner.mjs`); **delete**
  `permission-notification.mjs` (its unique assertions match success and failure identically —
  `waitForSnackbar(page, /notification sent|could not be sent/i)` — and it is hardwired to a named
  individual's workspace path and one developer's document UID); **delete**
  `profile-auth-verification.mjs` (its falsifiable half is already covered on two engines by
  `cross-browser.spec.ts:131`; its unique half compares two functionally identical extractors at a
  `WARN` severity that can never fail the run). All five must be fixed or deleted — leaving them
  implies coverage that does not exist.
- **R18. Remaining service specs and error paths.** §7.1, §9.3. _Large._
- **R19. Sorting coverage beyond search; pagination consistency.** _Medium._

### P3 — nice to have

- **R20.** De-flake the latent timing risks (QW11). _Small._
- **R21.** Delete the two Nx-scaffold smoke specs (`core.spec.ts`, `ui.spec.ts`) and fix the
  misleading titles in §9.10. _Small._
- **R22.** Specify and then test retry/timeout/offline behaviour (§8) — a product decision first.
  _Large._
- **R23.** Decouple E2E assertions from untranslated English literals ahead of localisation.
  _Medium._

---

## 14. Assumptions, limitations and items needing team confirmation

### 14.1 Assumptions — labelled, not measured

- **Every effort estimate** (Small/Medium/Large/Very Large) is an assumption. None is derived
  from historical velocity on comparable work in this repository.
- **Every priority** is judgement applied to evidence. The change-frequency and `fix:`-commit
  figures in §13 are real counts, but the inference from them to risk is not a measurement.
- The **12–15 minute nightly estimate** in §12.2 extrapolates a measured 165 s suite by an assumed
  container cold start and `npm ci` time. The 165 s is measured; the rest is not.
- **Risk ratings** in §6 and §7 are judgement, informed by blast radius and change frequency.
- §9.3's **error-path counts** are marker-based heuristics per spec, not per-method audits.
  `browse.service.spec.ts` was manually corrected after the heuristic misled; others were not
  re-checked to that depth.

### 14.2 Limitations of this audit

- **The 13 beta-harness evidence steps were not executed** (§4.7). Analysed statically only.
- **Everything ran on one machine, one OS, one Nuxeo instance** with 42 File documents. Results
  on a different repository state — particularly the two conditional skips in §5.2 — may differ.
  Neither skip fired here; that is not proof they never do.
- **Coverage figures exclude everything E2E and the harness prove**, and exclude `nuxeo-ui`
  entirely. Playwright runs against a served production-style bundle and contributes nothing to
  the v8 numbers. Any "coverage is X%" statement in this document is about the measured Vitest
  subset of 19 projects and nothing else. This caveat is the reason §4.1 and §4.4 are separate
  sections.
- **`main` moved during the audit.** Everything here is against `0ced6667`.
- **The worktree was left in place** rather than torn down, at the user's instruction, so these
  results can be inspected. The plan's Phase 8 teardown step was deliberately skipped.

### 14.3 Items needing team confirmation

1. **The CI container route** (§12.3) — self-hosted runner, or `packages.nuxeo.com` secrets plus
   a compose file? Everything nightly depends on this, and it is the roadmap's critical path.
2. **The WebKit failures** (§5.1) — is a disabled-but-interactive submit button that Safari users
   cannot reach by keyboard the accessibility defect NXENG-750 exists to fix (product change), or
   is the assertion untestable on WebKit's platform default (test change)? This determines whether
   R1 is a one-line scope or a product fix, and it should be answered by whoever owns NXENG-750.
3. **Should `/#/search?q=…` work?** (§9.1.2, QW3.) The specs assume it does; the component does
   not read it. Making the search component honour the URL parameter is arguably the real fix and
   would make shared search links work — but it is a product change, not a test change.
4. **Is `trash` in Beta scope?** `coverage-gate.mjs` excuses `tasks`, `administration` and the KD
   libraries from the 90% bar by naming them in `OUT_OF_SCOPE`. `trash` is named nowhere, has no
   test target and so is invisible to the gate in a third way — neither in scope nor excused. It
   needs an explicit decision either way.
5. **Real-Nuxeo suite vs recorded fixtures** (§11.1) — the recommendation is both, in sequence.
   Confirm before Stage 4, since the harness design differs.
6. **Does the `Administrator`/`Administrator` fallback stay?** (§5.4, R11.) It is convenient
   locally and invisible in CI. The proposal is to keep it but make it loud.
7. **`providers.spec.ts:101` asserts a defect is present** and will fail when the defect is fixed.
   Is that the intended contract, or should it be a `.todo` with the ticket reference?
8. **Two folders leaked into the shared Nuxeo** during this audit by
   `clipboard-move-scenarios.mjs` (§4.6): `/default-domain/workspaces/nxsat183-source-17899611`
   and `…-target-17899611`. Left in place deliberately as evidence of the no-teardown defect.
   Confirm whether to clean them up.

---

## 15. Phase verification record and evidence index

### 15.1 Phase verification summary

Each phase passed its own verification before the next began. Full blocks are at §2.7, §3.4,
§4.8, §6.5, §9.12; Phases 6–8 are covered here.

- **Phase 1 — Architecture discovery. PASSED** (§2.7). 20 test-target projects reconciled against
  19 `vite.config.mts` plus one `ng test`; all 27 projects classified; 14 workflows read.
- **Phase 2 — Inventory. PASSED** (§3.4). 184 rows = 184 files; both skips accounted; zero
  `.only`/`.todo`. One deliberate deviation recorded.
- **Phase 3 — Execution. PASSED** (§4.8). Vitest, Karma, the ratchet, both engines separately
  ×3, the Nx target, the five orphans. Every failure and skip classified; the one non-executed
  item recorded in the required format.
- **Phase 4 — Coverage matrix. PASSED** (§6.5). Every route once; every service once, against
  disk rather than the stale doc.
- **Phase 5 — Quality. PASSED** (§9.12). Every load-bearing claim independently verified against
  source; three subagent claims corrected by that check.
- **Phase 6 — Implementation scope.** Nine stages (§11), each with objective, scope, effort,
  risks, acceptance criteria and verification command; the real-Nuxeo-vs-fixtures decision argued
  with the constraint that settles it. _Verification:_ every P0/P1 gap in §6–§8 maps to at least
  one stage — checked by walking §6.4's workflow list and §7.2's service list against §11.2.
- **Phase 7 — CI/CD plan.** §12. Defers to NXSAT-231 for the E2E half and contributes measured
  sizing, the per-PR subset recommendation, and the shared-container argument. _Verification:_
  NXSAT-231 was fetched and read in full; §12.2 restates none of its scope.
- **Phase 8 — Deliverable.** All 15 sections present; P0–P3 and Small/Very Large throughout;
  assumptions labelled in §14.1. _Verification:_ the contents list was walked against the
  document.

### 15.2 Final verification checklist

- Every test file appears in the inventory with a status — **yes**, 184 of 184 (§3).
- Full Vitest suite and both Playwright engines executed and recorded — **yes** (§4.1, §4.3, §4.5).
- Every failure, skip and blocker classified by root cause — **yes** (§5).
- Every E2E result attributed to a named engine, never merged — **yes** (§4.5).
- Coverage matrix covers all 8 feature modules and every service, each once — **yes** (§6, §7).
- Every recommendation carries priority, effort and acceptance criteria — **yes** (§13, §11.2).
- Estimates not directly measured labelled as assumptions — **yes** (§14.1).
- A direct verdict on the epic's two DoD lines — **yes** (§1.2).
- All 15 deliverable sections present — **yes**.

### 15.3 Evidence index

All under `~/Desktop/agentic-ui-evidence/NXSAT-286/audit/`, outside the repository.

- `inventory.mjs`, `inventory.json` — the read-only inventory script and its 184-row output.
- `logs/inventory.txt` — inventory summary, including the HTTP-without-verify and
  createComponent-without-detectChanges lists.
- `logs/vitest-runmany.log` — full suite with coverage; per-project timings; the `--coverage`
  failure.
- `logs/vitest-nuxeo-ui.log` — the Karma run, 135/135.
- `logs/beta-coverage.log` — the ratchet, exit 1.
- `logs/beta-state.log` — `beta:state`, exit 1.
- `logs/preflight-no-creds.log` — preflight passing without credentials exported.
- `logs/pw-chromium-run{1,2,3}.log`, `logs/pw-webkit-run{1,2,3}.log` — three runs per engine.
- `logs/pw-chromium-run1-results.json`, `logs/pw-webkit-run1-results.json` — JSON reporter output.
- `logs/nx-e2e-target.log` — `nx run nuxeo-ui-e2e:e2e`, 36/38, exit 1.
- `logs/orphan-*.log` — the five orphaned scripts, all exit 1.
- `logs/fixture-leak.txt` — NXQL confirmation of the two leaked folders.
- `logs/devserver.log` — the dev server on port 4210.
- Playwright failure artifacts — traces, videos and screenshots for the two WebKit failures — are
  in the worktree at `dist/e2e/artifacts/` (gitignored build output).
