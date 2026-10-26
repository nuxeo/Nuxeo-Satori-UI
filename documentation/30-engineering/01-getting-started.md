---
title: Developer Getting Started
parent: Engineering
order: 1
last_reviewed: 2026-10-15
repo_commit: c053e63
audience: engineering
---

# Developer Getting Started — zero to productive

> **Last reviewed:** 2026-10-15 · **Repository:** `c053e63` (`integration/nxsat-308`)
> Only the adf-hx bridge and POC-route passages were re-verified at that commit, for NXSAT-648.
> Before that, last reviewed 2026-10-14 at `d36176c` (`feature/nxsat-308-remove-adf-packages`):
> Only the registry guidance (the token row and install snippet, `.npmrc` and the `E404` row) was re-verified at that commit,
> for NXSAT-637; the gate guidance (the lockfile trap) on 2026-10-08 at `fb97d44`; the rest of the
> page was last reviewed on 2026-08-24 at `77265f9`.

The goal of this page is that you reach a running application, a green gate and your first
commit **without asking anyone**. If you get stuck on something not covered here, that is
a defect in this page — fix it as part of your first contribution.

Budget about two hours, most of which is Docker pulling Nuxeo.

---

## 1. Prerequisites

| Requirement                | Version                           | Why this exact version                                                                                                         |
| -------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Node.js                    | **20.x**                          | Pinned in [`.nvmrc`](../../.nvmrc) and `engines` in [`package.json`](../../package.json). Not optional — see the warning below |
| npm                        | 10.x (ships with Node 20)         | The lockfile is `lockfileVersion` 3                                                                                            |
| Docker + Docker Compose    | any current                       | Runs Nuxeo, OpenSearch, and optionally ARender and Mailpit                                                                     |
| Java + Maven               | 17+, Maven 3.9+                   | Only if you need to build the marketplace package ([`pom.xml`](../../pom.xml))                                                 |
| `SATORI_GH_READONLY_TOKEN` | a GitHub PAT with `read:packages` | Required to install the `@hylandsoftware` packages                                                                             |

### The Node version will bite you

Use Node 20. On Node 22+ a built-in `localStorage` global shadows jsdom's, and specs that
touch `localStorage` fail with `SecurityError` **on correct code**. The temptation is then
to edit the failing spec, which damages working code.

`npm run beta:gate` works around it by passing `--no-experimental-webstorage` to every
child process. A bare `npx nx test` does **not**.

```bash
nvm use            # reads .nvmrc → 20
node -v            # must print v20.x
```

If you are on a newer Node and cannot switch, route **every** verification through
`npm run beta:gate` and read the warning it prints at startup — it is gate zero
([`scripts/beta-harness/node-version.mjs`](../../scripts/beta-harness/node-version.mjs))
and exists precisely because this cost someone a day.

---

## 2. Clone and install

```bash
git clone <repo-url> agentic-ui-poc
cd agentic-ui-poc
export SATORI_GH_READONLY_TOKEN=<your-pat>   # needs read:packages on the Hyland org
npm ci
```

### Use `npm ci`, never a bare `npm install`

This is the single most expensive mistake available in this repository, and it has already
broken CI for the length of an entire phase.

A bare `npm install` on macOS **prunes optional platform entries that Linux needs** —
specifically `@oxc-resolver/binding-wasm32-wasi`'s nested `@emnapi/core` and
`@emnapi/runtime` — and `npm ci` on the Linux CI runner then refuses the whole tree.
`--os`/`--cpu` do not restore them.

If you need to add a dependency:

1. Restore a known-good `package-lock.json`.
2. Add the dependency.
3. Merge **only** the new entries in.
4. Run `node scripts/beta-harness/lockfile-integrity.mjs` before committing.

That gate is first in the pipeline because nothing else can see this failure: `npm ci
--dry-run` only demands the entries the current platform resolves, so on macOS it never
looks at the pruned Linux subtree and passes.

### Why `.npmrc` matters and is not enough

[`.npmrc`](../../.npmrc) maps `@hylandsoftware` to GitHub Packages, where
`@hylandsoftware/satori-ui` and the fonts, icons and tokens it depends on are published. The
`@alfresco` mapping went in NXSAT-637 with the last `@alfresco` package.

And note: `npm ci` installs from each lock entry's `resolved` URL and **ignores** the
registry mapping. If you change a scope's registry you must regenerate the lock, or CI
keeps fetching from the old host.

---

## 3. Start the backend

The application is a client. Without Nuxeo it renders shells and proves nothing.

```bash
docker ps                        # is a `nuxeo` container already running on :8080?
```

Nuxeo runs locally in Docker (container `nuxeo`, port 8080) with OpenSearch. Setup detail
is in [`docs/opensearch-setup.md`](../../docs/opensearch-setup.md); the server-side config
fragments this project needs are in [`nuxeo-conf/`](../../nuxeo-conf) — read
[`nuxeo-conf/README.md`](../../nuxeo-conf/README.md).

Verify it the way the harness does:

```bash
npm run beta:backend
# → backend-preflight: pass — Nuxeo is serving at http://localhost:8080 (HTTP 200, user Administrator).
```

### Optional services

| Service | Command                                                                      | What it gives you                                                                                                                                                      |
| ------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARender | `docker compose -f arender-docker-compose.yml --env-file .env.arender up -d` | The document viewer. Setup: [`docs/arender-setup.md`](../../docs/arender-setup.md) — copy [`.env.arender.example`](../../.env.arender.example) to `.env.arender` first |
| Mailpit | `docker compose -f mailpit-docker-compose.yml up -d`                         | Local SMTP, for permission-notification emails                                                                                                                         |

---

## 4. Run the application

```bash
npx nx serve nuxeo-ui        # or: npm run dev
```

Open **http://localhost:4200**. Sign in as `Administrator` / `Administrator` unless
`NUXEO_USER` / `NUXEO_PASS` say otherwise.

The dev server proxies `/nuxeo` to `http://localhost:8080` via
[`apps/nuxeo-ui/proxy.conf.json`](../../apps/nuxeo-ui/proxy.conf.json), which is why the
app can use same-origin URLs and why you must reach Nuxeo _through_ :4200 in tests rather
than hitting :8080 directly.

### Two apps, and they are different

| App                     | Purpose                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `nuxeo-ui`              | The product. Every feature library, adf-hx, Material, Satori design system                                                                    |
| `nuxeo-satori-template` | The **forkable customer template**. Deliberately ships no design system, so a customer brings their own. `npx nx serve nuxeo-satori-template` |

---

## 5. Environment variables

Credentials come from the environment only — never hardcoded, never in a URL query string.
That rule is enforced by `checkHardcodedSecrets` in
[`scripts/review-guardrails.mjs`](../../scripts/review-guardrails.mjs). For the Nuxeo pair,
`checkNoNuxeoCredentialDefaults` fails the common shapes of a read defaulted to a literal under
`scripts/`, `tools/` and `a11y/` — a fallback to another variable or a command is not one.
`NUXEO_USER` and `NUXEO_PASS` have **no default**: a harness, preflight or tool that talks to
Nuxeo refuses to run without them, and a steps or scenes file that needs no backend opts out with
`skipHttpCredentials = true`.

| Variable                              | Default                         | Used by                                                          |
| ------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| `NUXEO_USER`                          | — (required)                    | Evidence harness, E2E, preflights                                |
| `NUXEO_PASS`                          | — (required)                    | as above                                                         |
| `SATORI_GH_READONLY_TOKEN`            | —                               | `npm ci`, CI package installs                                    |
| `E2E_BASE_URL`                        | `http://localhost:4200`         | E2E suite                                                        |
| `AGENTIC_UI_EVIDENCE_DIR`             | `~/Desktop/agentic-ui-evidence` | Where evidence is written                                        |
| `NUXEO_DOC_UID`, `NUXEO_FILE_DOC_UID` | —                               | Some per-ticket evidence runners                                 |
| `BETA_GATE_NODE_STRICT`               | unset                           | Set to `1` to fail the gate on any Node major but the pinned one |

Full list: `grep -rhoE "process\.env\[?'?\"?[A-Z_]+" apps libs scripts tools`.

---

## 6. Run the checks

### The fast inner loop

```bash
npm run beta:gate -- --gates lockfile,guardrails,lint
```

### The full gate — 17 gates

```bash
npm run beta:gate -- --phase my-change
```

Order is cheapest-first and it **stops at the first failure**, because a lint error usually
explains the test failure that would follow. See
[Dev Harness & Gates](08-dev-harness-and-gates.md) for what each gate does and why it
exists.

### Two traps that have each cost a phase

1. **`test` does not typecheck.** Vitest strips types through esbuild. Only `build` and
   `typecheck` catch a TypeScript error, and they run late. A green `test` is not type
   safety.
2. **Nothing except the `lockfile` gate checks that `package-lock.json` will install.** CI
   was red for the whole of Phase 2 while every local gate was green.

### The E2E suite needs the live stack

```bash
npm install --no-save @playwright/test    # deliberately untracked, see below
npx playwright install chromium
npm run beta:e2e
```

Playwright is installed with `--no-save` **on purpose** so CI installs are not burdened
with a browser download. That is why it is not in `package.json` and why
[`scripts/beta-harness/e2e-preflight.mjs`](../../scripts/beta-harness/e2e-preflight.mjs)
exits 2 with the install command when it is missing.

---

## 7. Where you are in the programme

Do not read status from prose. Run:

```bash
npm run beta:state
```

It resolves every phase's cited evidence manifest and gate report and is red whenever a
phase claims more than the artifacts support. The narrative version is the **Programme
status** section of [`docs/adf-hx-beta-plan.md`](../../docs/adf-hx-beta-plan.md), which is
dated.

At `77265f9`: Phases 0–5 complete, Phase 6 in progress (steps 0–2 of 7). **As of 2026-09-23 Phase 6 is 5 of 7**, with steps 3 (WCAG, back in question) and 6 (coverage, reopened) open.

---

## 8. Read these before writing code

In this order. They are not auto-loaded and they encode mistakes that have already been
paid for.

1. [`AGENTS.md`](../../AGENTS.md) — architecture and conventions in one page
2. [`CLAUDE.md`](../../CLAUDE.md) — the hard-won rules, and the non-negotiables
3. [`AGENTS/11-beta-program.md`](../../AGENTS/11-beta-program.md) **section 3** — verified
   facts. Established first-hand. If you believe one is wrong, **prove it before acting on
   it**; two phases contradicted a verified fact without proof and both cost real time
4. The `AGENTS/` file for your task — services, Nuxeo APIs, test standards, security, bug
   patterns

### The non-negotiable conventions

From [`CLAUDE.md`](../../CLAUDE.md), each one enforced or hard-won:

- `standalone: true` on every component — no NgModules
- `inject()` for DI — never constructor parameters
- `signal()` for mutable UI state — never `BehaviorSubject`
- `takeUntilDestroyed()` on **every** `.subscribe()`
- `templateUrl` always — no inline templates
- Never `<img [src]="nuxeoUrl">` — fetch via a service, use a blob URL, revoke on destroy.
  Enforced by `checkNoNuxeoUrlInImgSrc` and `checkBlobUrlLifecycle`
- Never cross-feature imports — shared logic goes in `libs/shared/`. Enforced by real
  `depConstraints` in [`eslint.config.mjs`](../../eslint.config.mjs); **an untagged project
  cannot depend on anything**, so a new library needs `scope:` and `type:` tags
- adf-hx types must never appear in our public API — nothing imports adf-hx since its bridge was
  removed with the POC routes (NXSAT-635); do not reintroduce it
- Anything a customer might want to change goes through Layer 0 or 1, not a hardcoded value

---

## 9. Your first contribution

1. **Branch.** Never commit to `main`.
   ```bash
   git checkout -b fix/<short-description>
   ```
2. **Make the smallest change that could satisfy a stated assertion.** If you cannot state
   the assertion before writing the code, the task is too vague — split it.
3. **Add or update a unit test, including the error path.**
4. **Run the fast loop, then the full gate.**
5. **Commit.** Husky runs lint-staged: ESLint `--fix` on `.ts`, Prettier on everything.
   Conventional commits — see [`AGENTS/06-git-workflow.md`](../../AGENTS/06-git-workflow.md).
6. **Push, then actually check CI.**
   ```bash
   gh run list --branch <your-branch> --limit 3 --json status,conclusion,headSha,event
   ```
   Only a CI run is authoritative — local gates run on your Node, CI runs on the pinned
   one. This rule was stated in the agent contract and then broken across twenty
   consecutive pushes while CI was red for sixteen of them. Note that
   `concurrency.cancel-in-progress` is on, so pushing again **cancels** the previous run; a
   `cancelled` conclusion on an older commit is expected.

---

## 10. Common problems

| Symptom                                                               | Cause                                                                                                  | Fix                                                                                                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SecurityError` on `localStorage` in specs                            | Node 22+ shadows jsdom's `localStorage`                                                                | Use Node 20, or run via `npm run beta:gate`                                                                                                                                        |
| `npm ci` fails on CI, green locally                                   | A bare `npm install` pruned Linux-only optional entries                                                | Restore a known-good lock, merge new entries only                                                                                                                                  |
| `E404` installing `@hylandsoftware/*`                                 | `SATORI_GH_READONLY_TOKEN` missing or lacks `read:packages` on the **Hyland** org                      | Set the token; it needs `read:packages` on the Hyland org                                                                                                                          |
| `NG0201: No provider for …` after adopting an adf-hx component        | Upstream services are `providedIn: 'root'` and resolve ports from the root injector                    | Provide the port in the **root** injector, not on the component. See the long comment in [`apps/nuxeo-ui/src/app/app.config.ts:37`](../../apps/nuxeo-ui/src/app/app.config.ts#L37) |
| adf-hx components render raw keys like `MANAGE_VERSIONS.DIALOG.TITLE` | An i18n catalogue is missing from the bundle; the loader catches the 404 and returns `{}` **silently** | `npm run beta:bundle` — it asserts the catalogues are present _and non-empty_                                                                                                      |
| HTTP 500 from an `AI.*` operation                                     | The AI backend is a **separate marketplace package not in this repo**                                  | Expected, not a client defect. See [Runtime AI Features](10-runtime-ai-features.md)                                                                                                |
| Empty screens, intermittent 403 on `/nuxeo/api`                       | Session injected but XHRs unauthenticated                                                              | Both mechanisms are required — see the auth note in [Testing & Evidence](12-testing-and-evidence.md)                                                                               |
| Evidence run passes suspiciously                                      | A capture that asserts nothing                                                                         | `npm run beta:audit` fails any assertion incapable of failing                                                                                                                      |
| `beta:state` red after you added a gate                               | Every phase cites a re-gate with a smaller gate count                                                  | Re-run the full gate and re-cite. Do not relax the check — it has been right both times                                                                                            |

---

## 11. Extending the system

| I want to…                           | Go to                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Add a feature to the product         | [Code KT](11-code-kt.md) → "Where do I make this change?"                                                |
| Make something customer-configurable | [Extensibility Contract](07-extensibility-contract.md)                                                   |
| Add an extension point               | [`.cursor/skills/add-extension-point/SKILL.md`](../../.cursor/skills/add-extension-point/SKILL.md)       |
| Adopt a real adf-hx component        | [`.cursor/skills/adopt-adf-hx-component/SKILL.md`](../../.cursor/skills/adopt-adf-hx-component/SKILL.md) |
| Add a Nuxeo API call                 | [`AGENTS/02-nuxeo-apis.md`](../../AGENTS/02-nuxeo-apis.md)                                               |
| Run a Beta phase end to end          | [`.cursor/skills/beta-phase/SKILL.md`](../../.cursor/skills/beta-phase/SKILL.md)                         |
| Understand the AI tooling            | [Skills, Agents & Generators](09-skills-agents-generators.md)                                            |
