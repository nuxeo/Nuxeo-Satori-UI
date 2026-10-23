---
title: Tools & Commands
parent: Engineering
order: 6
last_reviewed: 2026-10-14
repo_commit: d36176c
audience: engineering
---

# Tools & Commands — complete reference

> **Last reviewed:** 2026-10-14 · **Repository:** `d36176c` (`feature/nxsat-308-remove-adf-packages`)
> Only the `SATORI_GH_READONLY_TOKEN` row was re-verified at that commit, for NXSAT-637; the three
> `beta:coverage` rows on 2026-10-09 at `effd434`; §3 (the gate and the
> dependency-tree commands) was re-verified on 2026-10-08 at `fb97d44`; the rest of the page was
> last reviewed on 2026-08-24 at `77265f9`.
> Source of truth: the `scripts` block in [`package.json`](../../package.json). If a command
> here does not exist, this page is wrong — fix it.

---

## 1. Setup

| Command                                  | Purpose                            | Notes                                                  |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| `nvm use`                                | Select Node 20 from `.nvmrc`       | **Not optional.** Node 22+ breaks `localStorage` specs |
| `export SATORI_GH_READONLY_TOKEN=<pat>`  | Auth for `@hylandsoftware`         | Needs `read:packages` on the Hyland org                |
| `npm ci`                                 | Install from the lockfile          | **Never** a bare `npm install` — see below             |
| `npm install --no-save @playwright/test` | Playwright, deliberately untracked | Then `npx playwright install chromium`                 |

### `npm install` vs `npm ci`

A bare `npm install` on macOS prunes optional platform entries Linux needs
(`@oxc-resolver/binding-wasm32-wasi`'s nested `@emnapi/core`, `@emnapi/runtime`), and
`npm ci` on the Linux runner then refuses the whole tree. `--os`/`--cpu` do not restore them.

Recovery: restore a known-good lock, merge only the new entries, run
`node scripts/beta-harness/lockfile-integrity.mjs`.

---

## 2. Run

| Command                                                                      | Purpose                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------- |
| `npx nx serve nuxeo-ui` · `npm run dev`                                      | The product on `:4200`, proxying `/nuxeo` → `:8080` |
| `npx nx serve nuxeo-satori-template`                                         | The forkable customer template                      |
| `npx nx build nuxeo-ui --configuration=production`                           | Production build                                    |
| `npx nx build platform`                                                      | The publishable package → `dist/libs/platform`      |
| `npm run watch`                                                              | Build in watch mode                                 |
| `docker compose -f arender-docker-compose.yml --env-file .env.arender up -d` | ARender document viewer                             |
| `docker compose -f mailpit-docker-compose.yml up -d`                         | Local SMTP                                          |
| `mvn package`                                                                | The marketplace package (needs Java 17+)            |

---

## 3. Verify — the gate

| Command                                                 | Purpose                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run beta:gate -- --phase <id>`                     | Every gate (26), cheapest first, stop at first failure       |
| `npm run beta:supply-chain`                             | SCA: production audit, dated acceptances, unimported deps    |
| `npm run beta:code-scanning`                            | Reads the CodeQL alerts; fails if the ref was never analysed |
| `npm run beta:gate -- --gates lockfile,guardrails,lint` | Fast inner loop                                              |
| `npm run beta:gate -- --gates <id>`                     | Any subset. An unknown id prints the valid list              |
| `npm run beta:gate -- --base <ref>`                     | Change the affected-calculation base (default `origin/main`) |
| `npm run beta:gate -- --tail <n>`                       | Lines of failing output to show (default 40)                 |

Verdicts: `pass` (every gate ran green), `pass-incomplete` (every gate requested, none failed,
but one reported NOT RUN, e.g. code scanning skipped — **not** a phase gate), `pass-partial` (a
filtered run — **not** a phase gate), `fail`. A report is written under `~/Desktop/agentic-ui-evidence/beta/gates/`.

### Individual gates

| Command                                                                | Asserts                                                              | Exit                                                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run beta:api`                                                     | Published `.d.ts` matches the snapshot                               | 1 on drift                                                                                                             |
| `npm run beta:api -- --update`                                         | Re-record the snapshot                                               | Review the diff                                                                                                        |
| `npm run beta:publishable`                                             | 7 checks incl. a real `npm publish --dry-run`                        | 1, or 2 if `dist` absent                                                                                               |
| `npm run beta:fork`                                                    | Template compiles against the built package                          | 1                                                                                                                      |
| `npm run beta:upgrade`                                                 | A Layer 0/1/2 customisation survives a version bump                  | 1, or 2 if `dist` absent                                                                                               |
| `node scripts/beta-harness/upgrade-rehearsal.mjs --break-slot toolbar` | **Negative control** — proves the slot check is sensitive            | 1 by design                                                                                                            |
| `npm run beta:bundle`                                                  | No banned symbols; required assets present and non-empty             | 1                                                                                                                      |
| `npm run beta:reference`                                               | Extension reference agrees with the code, both directions            | 1                                                                                                                      |
| `npm run beta:customer-guardrails`                                     | The shipped guardrail, against our reference library                 | 1                                                                                                                      |
| `npm run beta:audit`                                                   | Every evidence assertion can fail                                    | 1                                                                                                                      |
| `npm run beta:coverage`                                                | Ratchet (no regression/orphan/unratcheted); `FLOORS` met             | 1                                                                                                                      |
| `npm run beta:coverage -- --run`                                       | Run the tests first                                                  |                                                                                                                        |
| `npm run beta:coverage -- --update-baseline`                           | Re-record; prunes orphans                                            |                                                                                                                        |
| `node scripts/beta-harness/lockfile-integrity.mjs`                     | Every dependency edge resolves in the lock                           | 1                                                                                                                      |
| `node scripts/beta-harness/lockfile-integrity.mjs --lock <path>`       | Check a copy                                                         |                                                                                                                        |
| `npm run beta:dependency-tree`                                         | No ADF package in lock, installed tree, manifests, `.npmrc`, imports | 1 on any finding, **blocking** since the ADF removal (NXSAT-638) and report-only before; 2 if a location can't be read |
| `npm run beta:dependency-tree -- --blocking --list-files`              | Preview the blocking verdict, every importing file listed            |                                                                                                                        |
| `npm run beta:dependency-tree-selftest`                                | The gate's negative and positive controls                            | 1                                                                                                                      |
| `npm run review:guardrails`                                            | The 10 repo invariants                                               | 1                                                                                                                      |
| `npm run review:preflight`                                             | guardrails + affected lint + affected test                           | 1                                                                                                                      |

---

## 4. Test

| Command                                                                  | Purpose                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------- |
| `npx nx test <project>`                                                  | Unit tests for one project                               |
| `npx nx test <project> --coverage`                                       | With coverage                                            |
| `npx nx run-many -t test --all`                                          | Everything                                               |
| `npx nx affected -t test`                                                | Only what changed                                        |
| `npm run beta:e2e`                                                       | Preflight, then the 12 Playwright specs                  |
| `npm run beta:e2e-preflight`                                             | Just the preconditions. Exit **2** = fix the environment |
| `npx playwright test -c apps/nuxeo-ui-e2e/playwright.config.ts --headed` | Watch it run                                             |
| `npx playwright show-trace dist/e2e/artifacts/<dir>/trace.zip`           | Debug a failure                                          |

> Run unit tests through `npm run beta:gate` on Node 22+. A bare `nx test` does not get the
> `--no-experimental-webstorage` workaround and fails on correct code.

---

## 5. Evidence

| Command                                            | Purpose                                                         |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `npm run beta:backend`                             | Is Nuxeo reachable? Run before any evidence capture             |
| `npm run beta:evidence -- <phase-id>`              | Capture phase evidence. Needs a served app                      |
| `npm run beta:evidence -- <phase-id> <steps-file>` | Use a specific steps file                                       |
| `npm run evidence:collect`                         | Per-ticket evidence runners                                     |
| `npm run beta:state`                               | **Are the phase claims true?**                                  |
| `npm run beta:state -- --json`                     | Machine-readable                                                |
| `npm run beta:state -- --state <path>`             | Against a fixture — for exercising the gate's own failure modes |

Output goes to `~/Desktop/agentic-ui-evidence/` (override with `AGENTIC_UI_EVIDENCE_DIR`),
**outside the repository** — so it does not travel with a clone.

---

## 6. Lint, format, typecheck

| Command                              | Purpose                                           |
| ------------------------------------ | ------------------------------------------------- |
| `npm run lint`                       | All projects                                      |
| `npm run lint:affected`              | Only what changed                                 |
| `npx nx run-many -t typecheck --all` | `ngc` per library. **Catches what `test` cannot** |
| `npx prettier --write <paths>`       | Format                                            |
| `npx prettier --check <paths>`       | Verify                                            |

Husky + lint-staged run ESLint `--fix` on `.ts` and Prettier on everything staged.
`docs/api/platform.api.md` is in `.prettierignore` — Prettier reformats fenced code blocks
and silently corrupts the snapshot.

---

## 7. Generators

```bash
# In this repository
npx nx g ./tools/satori-generators:extension-library acme-extensions --owner=acme

# From the published package, as a customer
npx nx g @nuxeo/satori-platform:extension-library acme-extensions --owner=acme
npx nx g @nuxeo/satori-platform:extension-rule      is-legal-team --library=acme-extensions
npx nx g @nuxeo/satori-platform:extension-action    export-claim  --library=acme-extensions
npx nx g @nuxeo/satori-platform:extension-component claim-summary --library=acme-extensions
```

`--directory` is the **parent**: `--directory=libs/custom` yields `libs/custom/<name>`.
Default parent is `libs/extensions`.

| Command                                                           | Purpose                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `node scripts/build-platform-generators.mjs`                      | Compile generators into the package. Also the **only** thing that typechecks them |
| `node scripts/build-platform-generators.mjs --check`              | Verify the output is current                                                      |
| `npm run beta:sync-docs`                                          | Copy customer docs into the package before build                                  |
| `node libs/platform/guardrails/check-extension-library.mjs <dir>` | The guardrail, against any library                                                |

---

## 8. Nx utilities

| Command                                    | Purpose                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `npx nx show projects`                     | All 26 projects                                                                             |
| `npx nx show project <name>`               | One project's config and targets                                                            |
| `npx nx graph`                             | Interactive dependency graph                                                                |
| `npx nx graph --file=/tmp/g.json`          | Graph as JSON                                                                               |
| `npx nx affected -t <target> --base=<ref>` | Run a target on affected projects                                                           |
| `npx nx reset`                             | **Clear the cache and daemon.** Do this when project config changes are not being picked up |

> `npx nx reset` matters more than it looks. After changing tags or adding a project, the
> daemon serves a stale graph and lint reports violations that no longer exist — which reads
> as a real failure.

---

## 9. CI

| Command                                                                     | Purpose                   |
| --------------------------------------------------------------------------- | ------------------------- |
| `gh run list --branch <b> --limit 3 --json status,conclusion,headSha,event` | **Check CI. Every push.** |
| `gh run view <id> --log-failed`                                             | The failing step's log    |
| `gh pr create --base main --title "..." --body "..."`                       | Open a PR                 |

`concurrency.cancel-in-progress` is on: pushing again **cancels** the previous run. A
`cancelled` conclusion on an older commit is expected, and it means only the newest run has
verified anything.

---

## 10. Slides and showcase

| Command                                             | Purpose                                         |
| --------------------------------------------------- | ----------------------------------------------- |
| `npm run beta:slides`                               | Export the deck (`tools/video/export-pptx.mjs`) |
| `npm run beta:evidence -- showcase showcase-adf-hx` | Presentation-quality screenshots — not a gate   |
| `node scripts/beta-harness/annotate-showcase.mjs`   | Annotated comparison artifact                   |

---

## 11. Exit codes

| Code | Meaning                  | Do                                                  |
| ---- | ------------------------ | --------------------------------------------------- |
| 0    | Pass                     | —                                                   |
| 1    | Failed                   | Fix the code                                        |
| 2    | **Precondition not met** | Fix the **environment**. Do not iterate on the code |

Used by `beta:evidence`, `beta:e2e-preflight`, `beta:publishable`, `beta:upgrade`. The
distinction exists because iterating on code to fix a missing dev server damages working
code.

---

## 12. Command troubleshooting

| Error                                             | Cause                                                   | Fix                                                                           |
| ------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `Expected a single value for option "--coverage"` | Nx sees `--coverage` twice                              | Use `--coverage.enabled=true`                                                 |
| `Cannot find generator`                           | The package's `generators` field or manifest is missing | `node scripts/build-platform-generators.mjs`, then `npm run beta:publishable` |
| `no coverage reports found under coverage/`       | Tests have not run with coverage                        | `npm run beta:coverage -- --run`                                              |
| `dist/libs/platform does not exist`               | Gate reads built bytes                                  | `npx nx build platform`                                                       |
| `@playwright/test is not installed`               | Deliberately untracked                                  | `npm install --no-save @playwright/test`                                      |
| `PRECONDITION NOT MET` from e2e-preflight         | No dev server, or an **empty** Nuxeo                    | Start `nx serve nuxeo-ui`; import a document                                  |
| `beta:state` FAIL after adding a gate             | Phases cite a re-gate with fewer gates                  | Re-run the full gate, re-cite. **Do not relax the check**                     |
| Lint reports a boundary violation you just fixed  | Stale Nx daemon graph                                   | `npx nx reset`                                                                |
| `unratcheted project` from beta:coverage          | New project absent from the baseline                    | `npm run beta:coverage -- --update-baseline`                                  |
| `orphaned baseline entr(ies)`                     | A project was deleted                                   | Same command — it prunes orphans                                              |
