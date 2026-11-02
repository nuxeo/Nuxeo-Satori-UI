---
title: Developer Getting Started
parent: Engineering
order: 1
last_reviewed: 2026-11-02
repo_commit: 561e927
audience: engineering
---

# Developer Getting Started — zero to productive

> **Last reviewed:** 2026-11-02 · **Repository:** `561e92759` (`main`)
> The **Node version, `localStorage` hazard, npm version, gate count, the `nuxeo-ui` description,
> three `Common problems` rows, the programme-status paragraph and the `Extending the system`
> table** were re-verified against the code at that commit and corrected — the Node and
> `localStorage` numbers had both been wrong since NXSAT-669.
> Before that, last reviewed 2026-10-15 at `c053e63` (`integration/nxsat-308`):
> only the adf-hx bridge and POC-route passages, for NXSAT-648.
> Before that, 2026-10-14 at `d36176c` (`feature/nxsat-308-remove-adf-packages`):
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
| Node.js                    | **24.x**                          | Pinned in [`.nvmrc`](../../.nvmrc) (`24`) and `engines` in [`package.json`](../../package.json) (`^24.15.0`). Not optional — see the warning below |
| npm                        | 11.x (ships with Node 24)         | The lockfile is `lockfileVersion` 3                                                                                            |
| Docker + Docker Compose    | any current                       | Runs Nuxeo, OpenSearch, and optionally ARender and Mailpit                                                                     |
| Java + Maven               | 17+, Maven 3.9+                   | Only if you need to build the marketplace package ([`pom.xml`](../../pom.xml))                                                 |
| `SATORI_GH_READONLY_TOKEN` | a GitHub PAT with `read:packages` | Required to install the `@hylandsoftware` packages                                                                             |

### The Node version will bite you

Use Node 24.

```bash
nvm use            # reads .nvmrc → 24
node -v            # must print v24.x
```

**Node 20 no longer works here, and the gate stops you rather than letting you find out
later.** Anything older than the pinned major fails gate zero outright — "the Angular 22 /
Nx 23 toolchain in this repo is not expected to work here, and any failure the later gates
report would be uninterpretable"
([`node-version.mjs:82-92`](../../scripts/beta-harness/node-version.mjs)). That changed with
NXSAT-669; before it, the repo pinned 20.

**The `localStorage` hazard is Node 25, not "22+".** Node moved `localStorage` from absent
on 20, 22 and 24 to a global getter on 25 that *throws* unless `--localstorage-file` is
given, and that global shadows jsdom's — so specs touching `localStorage` fail with
`SecurityError` **on correct code** (`node-version.mjs:145-146`). The temptation is then to
edit the failing spec, which damages working code. There is no hazard on Node 24, so if you
are on the pinned version this paragraph is history, not a warning.

If you are on Node 25 and cannot switch, route **every** verification through
`npm run beta:gate`: it passes `--no-experimental-webstorage` to every child process, and a
bare `npx nx test` does **not**. The gate prints a `PASS WITH WARNING` saying exactly that
(`node-version.mjs:116-133`), and it **probes** the hazard rather than matching a version
number, so a future Node that reintroduces it is caught without this page being edited.

Set `BETA_GATE_NODE_STRICT=1` to make any major but the pinned one a hard failure. CI does
**not** set it and does not need to — every workflow installs Node 24 directly, by
`node-version: 24` or `node-version-file: .nvmrc`, so the running major already equals the
pinned one. The flag is for holding a local run to the same standard.

### Two Node versions, both correct — do not flatten them

This page is the **contributor** path: building and testing the Angular application, which
needs Node 24. A **customer** building a configuration package is on a different path with a
different floor — that needs only Node 20, no `npm ci` and no registry token, and the
scaffolder and build script use Node built-ins only. Measured on 20, 22, 24 and 25 with
byte-identical output.

Confusing the two has already cost time in review. If you are writing about the customer
path, use the customer guide's wording — "Node.js 20 or later" — rather than quoting 24 from
here. That guide is `CUSTOMISING.md` at the repository root; it arrives with NXSAT-312's
customer-tooling change, so it is not linked from here until that lands.

---

## 2. Clone and install

```bash
git clone <repo-url> Nuxeo-Satori-UI
cd Nuxeo-Satori-UI
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
| `nuxeo-ui`              | The product. Every feature library, Material, and the Satori design system                                                                    |
| `nuxeo-satori-template` | The **forkable customer template**. Built on plain Angular Material — a prebuilt theme at [`styles.scss:13`](../../apps/nuxeo-satori-template/src/styles.scss) — with **no Satori import of its own**, so a customer brings their own look (`libs/platform/AGENTS.md:278`). `npx nx serve nuxeo-satori-template` |

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

### The full gate

```bash
npm run beta:gate -- --phase my-change
```

**Do not quote a gate count from this page.** It was "17 gates" here for long enough to be wrong;
the gate prints its own total on every run (`3 of 35` in a partial run, for instance), and that
number is the only one worth repeating. `beta:state` goes red when a phase cites a run with fewer
gates than the pipeline now has, which is how the stale count surfaces.

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

This page used to end the section with a prose snapshot — "At `77265f9`: Phases 0–5 complete,
Phase 6 in progress" — directly under the instruction not to read status from prose. It is
removed rather than refreshed: a hand-written status two lines below "do not read status from
prose" is the instruction disproving itself, and `CLAUDE.md` records the same mistake being
believed for weeks elsewhere in the repository. Run the command.

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
| `SecurityError` on `localStorage` in specs                            | **Node 25** defines a throwing global `localStorage` that shadows jsdom's. Absent on 20, 22 and 24     | Use the pinned Node 24, or route every run through `npm run beta:gate`, which passes `--no-experimental-webstorage`. Do not edit the spec — the code is correct                     |
| `npm ci` fails on CI, green locally                                   | A bare `npm install` pruned Linux-only optional entries                                                | Restore a known-good lock, merge new entries only                                                                                                                                  |
| `E404` installing `@hylandsoftware/*`                                 | `SATORI_GH_READONLY_TOKEN` missing or lacks `read:packages` on the **Hyland** org                      | Set the token; it needs `read:packages` on the Hyland org                                                                                                                          |
| `NG0201: No provider for …` from a library service                    | The service is `providedIn: 'root'` and resolves its dependency from the root injector                 | Provide it in the **root** injector, not on the component. (This row named adf-hx until NXSAT-308 removed it; the cited comment is gone and `app.config.ts:37` is now unrelated)    |
| Components render raw translation keys instead of text                | An i18n catalogue is missing from the bundle; `AppTranslateLoader` catches the 404 and returns `{}` **silently** | `npm run beta:bundle` — it asserts both runtime catalogues are present, non-empty and not truncated (`no-test-libs-in-bundle.mjs:106-126`); a 0-byte file used to pass   |
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
| Add an `nxs-` component              | `npx nx g ./tools/satori-generators:satori-component` — rules in [`AGENTS/00-architecture.md`](../../AGENTS/00-architecture.md), "Adding a component"       |
| Add a Nuxeo API call                 | [`AGENTS/02-nuxeo-apis.md`](../../AGENTS/02-nuxeo-apis.md)                                               |
| Run a Beta phase end to end          | [`.cursor/skills/beta-phase/SKILL.md`](../../.cursor/skills/beta-phase/SKILL.md)                         |
| Understand the AI tooling            | [Skills, Agents & Generators](09-skills-agents-generators.md)                                            |
