---
title: Testing & Evidence
parent: Engineering
order: 12
last_reviewed: 2026-10-16
repo_commit: 250ec9a
audience: engineering
---

# Testing & Evidence

> **Last reviewed:** 2026-10-16 · **Repository:** `250ec9a` (`integration/nxsat-308`)
> E2E section re-verified for NXSAT-646; other sections retain their earlier review scope.
> On 2026-10-15 at `c053e63`, only the adf-hx bridge and POC-route passages were re-verified at that commit, for NXSAT-648.
> Before that, last reviewed 2026-10-08 at `2898046` (`feature/nxsat-308-ci-cold-cache-tooling`):
> Only the repository links were re-verified at that commit: made relative rather than pinned to
> `feature/adf-hx-browse-poc`, every target present. The rest of the page as of 2026-08-24 · `77265f9`.
> Standards: [`AGENTS/05-test-standards.md`](../../AGENTS/05-test-standards.md)

---

## 1. Four layers of verification

| Layer     | Tool                        | Scope                               | In PR CI? |
| --------- | --------------------------- | ----------------------------------- | :-------: |
| Unit      | Vitest                      | 19 projects with a `test` target    |    ✅     |
| Typecheck | `ngc` per library           | Every library                       |    ✅     |
| E2E       | Playwright                  | Core slice + auth/engine checks     |    ❌     |
| Evidence  | Playwright + `phase-runner` | Per-phase claims against live Nuxeo |    ❌     |

The two that need a live backend cannot run on a PR runner. **That is a real limitation**, not a
solved problem.

---

## 2. Unit tests

```bash
npx nx test <project>
npx nx affected -t test
npm run beta:gate -- --gates test      # use this on Node 22+
```

### The trap

**A green `test` is not type safety.** Vitest transpiles through esbuild, which strips types
without checking them. Two real type errors once passed 46 green unit tests and were caught only
by `build`. Always run `typecheck`.

### What a test must assert

From `AGENTS/05-test-standards.md`, and each rule exists because of a real false green:

| Rule                                                        | Why                                                                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Assert **observable state**, not that a function was called | `expect(provideSpy).toHaveBeenCalled()` passes while nothing is registered                                      |
| For registrations, assert the **registry**                  | `expect(TestBed.inject(ExtensionActionRegistry).has('acme.actions.export')).toBe(true)`                         |
| For rules, assert **`false`**                               | An _unregistered_ rule ID also evaluates to `true`, so `toBe(true)` passes whether or not registration happened |
| Include the **error path**                                  | Agent-written happy-path-only tests are the common failure mode (RFC §7.2)                                      |

The canonical illustration: three generators once spliced every registration **inside a comment**,
reported success, printed the IDs they had "registered" — and lint, typecheck and six existing
specs all passed, because none of them named the new IDs.

### Coverage — a ratchet, not a threshold

```bash
npm run beta:coverage                     # check
npm run beta:coverage -- --run            # run the tests first
npm run beta:coverage -- --update-baseline
```

The bar is >90%. Nothing is near it, so a gate set at 90% would be red on every run — and _a gate
that cannot pass gets bypassed and then ignored, which is worse than no gate_. So it records where
each project is and fails on regression, while reporting the distance to 90% so the debt stays
visible.

| Project               |     Lines | Specs |
| --------------------- | --------: | ----: |
| `shared-app-config`   |      100% |     4 |
| `shared-extensions`   |     96.0% |     9 |
| `permission-dialogs`  |     93.9% |     3 |
| `shared-kd-client`    |     88.1% |     3 |
| `collections`         |     81.7% |     1 |
| `nuxeo-client`        |     78.4% |    29 |
| `shared-ke-client`    |     70.9% |     1 |
| `ui`                  |     68.2% |     4 |
| `knowledge-discovery` |     64.8% |     3 |
| `adf-hx-bridge`       |     65.6% |    12 |
| `administration`      |     62.1% |     3 |
| `browse`              |     56.7% |     4 |
| `document-detail`     | **29.8%** |     4 |
| `search`              | **22.8%** |     1 |
| `tasks`               |    _100%_ | **0** |
| `assets`              |    _100%_ | **0** |
| `core`                |    _100%_ | **0** |

_Changed by NXSAT-635 (2026-10):_ `adf-hx-bridge` was removed on 2026-10-14; its row is the
measurement above, kept as it was.

> **Three of those numbers are artefacts.** `tasks`, `assets` and `core` have **zero spec files**.
> Their coverage reports contain 0 total statements, so the summariser computes 0/0 as 100%. So
> **6 projects read as ≥90% and 3 genuinely are.** Any "N of 17 meet the bar" figure — including
> one written into the plan and delivery record — overstates. The fix is to treat a
> zero-statement report as unmeasured. **Open at `77265f9`.**

The ratchet also fails on an **orphaned** baseline entry (a project the workspace no longer has)
and an **unratcheted** project (measured but absent from the baseline, previously printed as `new`
and then silently excluded from every check).

---

## 3. E2E

The live suite runs against a served app and its own Nuxeo backend. The core slice is
`browse.spec.ts`, `search.spec.ts` and `document-detail.spec.ts`: 12 tests per browser at
`250ec9a6d`. The full suite also includes authentication and cross-engine checks; a core-slice
pass does not claim those additional tests passed.

### Prepare an isolated backend

Use a ticket-owned Docker Nuxeo and database with disposable data. Point the app's dev proxy at
that instance. Keep `NUXEO_USER` and `NUXEO_PASS` in the environment; there is no credential fallback.

Search requires a full-text-capable backend. The bundled H2 repository template hardcodes
`searchDisabled="true"`, so setting `nuxeo.fulltext.search.disabled=false` alone does not enable
it. For NXSAT-646, a private PostgreSQL 16 database and Nuxeo's bundled `postgresql` template
provided full-text search. Configure `nuxeo.db.host`, `nuxeo.db.port`, `nuxeo.db.name`,
`nuxeo.db.user` and `nuxeo.db.password` for that database, retaining other templates required
by the installed image. Restart only the ticket's container after changing its configuration.

The core suite discovers a direct `WorkspaceRoot` child of `/default-domain` and an indexed,
untrashed `File`; it does not pin a document UID. Search pagination creates and cleans up its
own uniquely named workspace and 41 Notes. Before running, verify that an authenticated
`default_search` request with `ecm_fulltext` returns HTTP 200 and a known seeded match. An
unfiltered File query can pass preflight even while full-text search is disabled.

NXSAT-643 owns the shared identity guard and committed parity seed/start scripts. Until that
work is merged, manually seeded runs using the existing fixtures are diagnostic results;
they do not fulfill NXSAT-646's requirement to use that guard and seed.

### Install and serve

Use Node 20 and install dependencies in an isolated checkout. Do not run `npm install` in a
checkout whose dependencies are hardlinked to another checkout.

```bash
npm ci
npm install --no-save @playwright/test @axe-core/playwright
npx playwright install chromium webkit
```

Install both untracked packages in the same command: a later `npm install --no-save` can prune
an earlier untracked install. Both browser engines must launch for preflight to pass.

Create a local `apps/nuxeo-ui/proxy.conf.ticket-nxsat-646.json` pointing at the ticket's Nuxeo
port, for example port 8096:

```json
{
  "/nuxeo": {
    "target": "http://127.0.0.1:8096",
    "secure": false,
    "changeOrigin": true,
    "autoRewrite": true
  }
}
```

Serve the app from that checkout in a separate terminal:

```bash
npx nx serve nuxeo-ui --port 4216 --proxy-config apps/nuxeo-ui/proxy.conf.ticket-nxsat-646.json
```

Set the credentials through the environment, then name the app's exact host and port before
sending credentials through its proxy:

```bash
export E2E_BASE_URL=http://localhost:4216
export E2E_ALLOWED_HOSTS=localhost:4216
npm run beta:e2e-preflight
npm run beta:e2e -- --project=chromium browse.spec.ts search.spec.ts document-detail.spec.ts --retries=0
npm run beta:e2e -- --project=webkit browse.spec.ts search.spec.ts document-detail.spec.ts --retries=0
```

These examples use Bash. On Windows, use Git Bash for the shell-based negative control, or set
npm's script shell to Git Bash for that invocation. For concurrent browser runs, use separate
checkouts and app ports, matching each host/port in its allowlist.

### Authentication and remaining guard work

The `signedIn` fixture injects the app session into `sessionStorage` before page scripts run;
Playwright's `storageState` does not preserve that storage. The config also supplies
`httpCredentials`. API fixture discovery uses an explicit Authorization header and checks
`/nuxeo/api/v1/me` before returning its API context.

Those existing checks do not implement NXSAT-643's shared guard before and after every
test/step, browser-session validation or anonymous-cookie-adoption control. Nuxeo can answer
as Anonymous with HTTP 200, so status codes and nonempty result sets alone cannot establish
who made the request. A green core suite does not prove those missing identity guarantees.

### Negative control and evidence retention

```bash
npm run beta:e2e-negative-control
```

The command first runs preflight with correct credentials, then runs the full Chromium suite
with a deliberately wrong password. The underlying Playwright run should exit 1. The control
wrapper exits 0 when at least five tests fail at an assertion of their own; hook, fixture and
navigation failures do not count. Exit 1 means the sensitivity threshold was not met; exit 2
means an environment prerequisite was missing. A successful control establishes credential
sensitivity, not that every assertion read repository data.

Archive `dist/e2e/results.json`, `dist/e2e/assertion-failures.json` and `dist/e2e/artifacts/`
after each build/browser run and before the negative control: later runs overwrite them.
The committed config retains screenshots and recordings only on failure. For successful-run
media, use a local config importing the committed config and changing only retention to
`screenshot: 'on'` and `video: 'on'`; pass that config with `-c`. Keep local configs, media and
reports outside the committed change. Review failures before rerunning, and retain the first
attempt and its diagnosis rather than accepting an unexplained retry pass.

### Before and after the rename

For NXSAT-646, the integration mainline before the rename merge was `de0080f94`, and the
renamed build was `250ec9a6d`. Each browser passed all 12 core tests on each revision with
retries disabled. The full Chromium negative control produced six counted assertion failures,
with three setup failures excluded; its wrapper passed while Playwright exited 1.

The initial H2 runs failed four full-text-dependent tests on each browser. After verifying the
PostgreSQL repair with an authenticated full-text request, both baseline runs were repeated.
The original failures and successful comparison are retained in the
[NXSAT-646 Jira evidence](https://hyland.atlassian.net/browse/NXSAT-646?focusedCommentId=3245128).
These are provisional diagnostics, not completion of the missing NXSAT-643 guard validation.

---

## 4. Evidence capture

```bash
npx nx serve nuxeo-ui                  # separate terminal
npm run beta:backend                   # preconditions
npm run beta:evidence -- <phase-id>
```

Playwright drives the live app through a per-phase **steps file**. Exit `0` pass, `1` fail, `2`
**precondition-not-met** — fix the environment, do not iterate on the code.

**Every step must record at least one check, and every check must pass.** A capture that asserts
nothing fails deliberately.

### The rules the evidence system enforces on itself

| Rule                                                   | Why                                                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assertions must be **capable of failing**              | `npm run beta:audit` statically rejects literals, self-comparisons, `Boolean(constant)`, negated constants and missing conditions. 257 assertions audited |
| Assert the **claim**, not the pulse                    | A falsifiable check on the app shell still only proves the app booted                                                                                     |
| A _reloaded_ app needs a real `page.reload()`          | `withHashLocation()` makes `goto('/#/x')` same-document, so `APP_INITIALIZER` never re-runs                                                               |
| Console-error suppressions are **listed** on every run | A suppression nobody looks at is how a regression stays invisible                                                                                         |
| Screenshot counts are not observations                 | `beta:state` warns when a phase's images are fewer unique than counted                                                                                    |

### Ticket evidence

~20 runners in `scripts/collect-evidence/`, one per Jira ticket (`NXSAT-151` … `NXSAT-201`),
capturing before/after for a specific fix — largely Nuxeo Web UI parity gaps. `npm run
evidence:collect`.

**Evidence is written outside the repository** to `~/Desktop/agentic-ui-evidence/`, so it does not
travel with a clone. **Anything load-bearing belongs in the repo docs.**

---

## 5. Accessibility

`expectNoA11yViolations()` runs axe against WCAG 2.1 A/AA tags. Only `serious` and `critical` fail
by default; everything is recorded at every impact so the debt is visible rather than filtered
away. If `@axe-core/playwright` is missing it is a **failed check**, never a silent skip.

Current state — **AA met on the fifteen cases scanned**, `KNOWN_VIOLATIONS` **empty** (2026-08-24):

| Rule                          | Nodes | Now | Owner                                        |
| ----------------------------- | ----- | --- | -------------------------------------------- |
| `label`                       | 42    | 0   | ours                                         |
| `nested-interactive`          | 40    | 0   | ours                                         |
| `button-name`                 | 21    | 0   | ours                                         |
| `role-img-alt`                | 12    | 0   | ours                                         |
| `color-contrast`              | 7     | 0   | ours                                         |
| `scrollable-region-focusable` | 2     | 0   | ours                                         |
| `aria-progressbar-name`       | 2     | 0   | ours                                         |
| `aria-required-children`      | 3     | 3   | **`@alfresco/adf-core@9.0.0`** — finding 1.2 |

The lesson is about the **baseline**, not the fixes. The previous capture scanned **three** surfaces
and ratcheted **four** rule ids. Widening it to fifteen cases found **seven** classes and 77 nodes,
and three of the classes lived only in view-mode and column-panel states a single visit per route
never reaches. A ratchet over an under-sampled scan reports "no new violations" while the ones it
cannot see accumulate — the same failure mode as a gate nobody has watched go red.

The single exclusion is scoped to the **adf-hx step alone**, not to `KNOWN_VIOLATIONS`, so the same
rule failing on a surface we own still fails the capture.

**Not covered:** dialogs, the upload flow, dark mode, and the pre-auth login surface. The last is a
harness limitation — the runner sets `httpCredentials`, so the app authenticates before login can
render.

---

## 6. What is not tested

| Gap                          | Detail                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/shared/ai-client`      | 457 lines, **0 specs, no `test` target** — invisible to the ratchet                                                                                        |
| `libs/features/trash`        | 2,866 lines, no `test` target                                                                                                                              |
| `tasks`, `assets`            | Zero specs. Reported a spurious 100% until 2026-08-24; the gate now calls them unmeasurable and fails on a baseline entry                                  |
| The AI operations themselves | Implemented in another package                                                                                                                             |
| Performance                  | No runtime performance testing. Bundle size only                                                                                                           |
| Security                     | SAST is CodeQL default setup (`default` suite, push + weekly), read by the `code-scanning` gate. SCA is `supply-chain`. Neither covers runtime pen-testing |
| Cross-browser                | **Chromium only.** WebKit is Phase 6 step 5 and is deliberately not registered in the config rather than registered-and-skipped                            |
| Rollback                     | The upgrade path is tested; rollback is not                                                                                                                |

---

## 7. Before you commit

```bash
npm run beta:gate -- --gates lockfile,guardrails,lint    # seconds
npm run beta:gate -- --phase my-change                   # all 15
npm run beta:e2e                                         # if you touched a critical path
gh run list --branch <branch> --limit 3 --json status,conclusion,headSha,event
```

**Only a CI run is authoritative.** Local gates run on your Node; CI runs on the pinned one.
`cancel-in-progress` means pushing again cancels the previous run — a `cancelled` conclusion on an
older commit is expected, and it means only the newest run verified anything.
