---
title: Testing & Evidence
parent: Engineering
order: 12
last_reviewed: 2026-10-15
repo_commit: c053e63
audience: engineering
---

# Testing & Evidence

> **Last reviewed:** 2026-10-15 · **Repository:** `c053e63` (`integration/nxsat-308`)
> Only the adf-hx bridge and POC-route passages were re-verified at that commit, for NXSAT-648.
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
| E2E       | Playwright, 12 specs        | 4 critical paths against live Nuxeo |    ❌     |
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

```bash
npm install --no-save @playwright/test && npx playwright install chromium
npm run beta:e2e
```

12 specs, 4 files, in `apps/nuxeo-ui-e2e/src/`:

| File                      | Asserts                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `browse.spec.ts`          | Repository listing, tree navigation, shell chrome                                             |
| `search.spec.ts`          | Non-zero results, a zero-result term, **an apostrophe** — the HXQL injection regression guard |
| `document-detail.spec.ts` | Metadata, the Permissions/History/Publishing tabs, an unknown id                              |
| `auth.spec.ts`            | A signed-out visitor **is** redirected; Anonymous is **not** granted administration           |

### Two design rules

**Assert repository data, not that a component rendered.** An unauthenticated XHR draws
`lib-browse` with no rows — visible, green under `toBeVisible`, and proof of nothing. Hence
`expectSurfaceWithData`.

**Discover the test document; never pin a UID.** A pinned UID passes on one machine and reads as a
product defect everywhere else. `document-detail.spec.ts` queries through the app's own proxy,
which also exercises the proxy and auth before the UI is involved.

### Sensitivity, measured

With deliberately bogus credentials, **9 of 12 specs fail**. The 3 that pass are the auth specs,
which are credential-independent by design. That is the evidence the suite reads real data rather
than just rendering.

### Authentication in tests — both mechanisms are required

| Mechanism                                                    | Satisfies                              |
| ------------------------------------------------------------ | -------------------------------------- |
| A session injected into `sessionStorage` via `addInitScript` | The **route guard**, so pages render   |
| `httpCredentials` in the Playwright config                   | **XHRs**, so `/nuxeo/api` returns data |

With only the first, `/nuxeo/api` intermittently returns 403 and you get screenshots of empty
states. Note `storageState` does **not** work here: it persists cookies and localStorage, and this
app keeps its session in `sessionStorage`. A `storageState` fixture would look right, run, and
leave every spec signed out.

### The anonymous-auth fact

The local Nuxeo has **anonymous authentication enabled**: `/me` with no credentials returns 200 and
`{ id: 'Anonymous' }`. `AuthService` then takes its intentional SSO-detection path and adopts that
session. So **"an unauthenticated visitor is redirected" is not observable here** — the guard is
sound; the environment makes the assertion untestable. Removing `httpCredentials` does not help,
because credentials were never what made `/me` succeed. Test the **privilege** boundary instead.

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
