---
title: Code KT
parent: Engineering
order: 11
last_reviewed: 2026-10-15
repo_commit: c053e63
audience: engineering
---

# Code Knowledge Transfer — "where do I make this change?"

> **Last reviewed:** 2026-10-15 · **Repository:** `c053e63` (`integration/nxsat-308`)
> Only the adf-hx bridge and POC-route passages were re-verified at that commit, for NXSAT-648.
> The rest of the page as of 2026-08-24 · `77265f9`.

The page to keep open while working. It answers _where_, not _what_ — see
[Architecture](02-architecture.md) for how the pieces fit.

---

## 1. Where do I make this change?

| I need to…                                         | Change                                                                                                  | Then                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a Nuxeo API call                               | A service in `libs/shared/nuxeo-client/src/lib/services/`                                               | Update `AGENTS/01-services.md` — **CI flags it as stale otherwise**. Read `AGENTS/02-nuxeo-apis.md` first                                   |
| Add a screen to an existing feature                | The feature library under `libs/features/<name>/src/lib/`                                               | Route it in `apps/nuxeo-ui/src/app/app.routes.ts`                                                                                           |
| Add a whole new feature area                       | A new library — follow `AGENTS/04-feature-scaffold.md`                                                  | Tag it `scope:features` + `type:feature`, or it cannot import anything                                                                      |
| Share something between two features               | Move it to `libs/shared/` — **never import feature→feature**                                            | If it must not be customer-facing, do **not** put it in `libs/shared/ui` (that is published)                                                |
| Add a shared presentational component              | `libs/shared/ui/src/lib/`                                                                               | This is **published API**. `npm run beta:api -- --update` and review the diff                                                               |
| Change what the nav shows                          | Nothing in code if a manifest can express it — Layer 1                                                  | Otherwise `apps/nuxeo-ui/src/app/extensions/provide-app-extensions.ts`                                                                      |
| Make something customer-configurable               | Layer 0 (`bootstrap.json`) or Layer 1 (manifest)                                                        | [Extensibility Contract](07-extensibility-contract.md). Use `add-extension-point` skill                                                     |
| Add a rule a manifest can reference                | `provide-app-extensions.ts`, plus `libs/shared/extensions/src/lib/document-rules.ts` for document rules | Document it in `docs/extension-reference.md`; `npm run beta:reference` gates both directions                                                |
| Add an adf-hx API port                             | Nothing — the bridge and its ports were removed on 2026-10-14 (NXSAT-635)                               | A new Nuxeo call goes in `nuxeo-client`: `add-nuxeo-api` skill. `implement-api-port` is a record only                                       |
| Swap a hand-written `hxp-*` for the real component | Nothing — adf-hx was removed (NXSAT-635, NXSAT-637)                                                     | A new `nxs-` component: `satori-component` generator. `adopt-adf-hx-component` is a record only                                             |
| Change theming                                     | `bootstrap.json` `themes[].tokens`, or a `--*` token declaration in `.scss`                             | Never a raw colour literal — `checkThemeTokens` fails it                                                                                    |
| Change auth behaviour                              | `apps/nuxeo-ui/src/app/auth/`                                                                           | Read `AGENTS/07-security.md`. Note the anonymous-auth fact in [Architecture §5](02-architecture.md#5-authentication-and-authorisation)      |
| Add an AI feature                                  | `libs/shared/ai-client` for the client; the **operation itself is in another repository**               | [Runtime AI Features](10-runtime-ai-features.md)                                                                                            |
| Add i18n strings                                   | The feature's own catalogue; loader is `apps/nuxeo-ui/src/app/i18n/app-translate-loader.ts`             | A seeded folder whose file is not shipped fails **silently** — `npm run beta:bundle`                                                        |
| Change what ships in the bundle                    | `angular.json` asset globs                                                                              | `npm run beta:bundle` — it asserts required assets are present **and non-empty**                                                            |
| Change the marketplace package                     | `nuxeo-agentic-ui-package/`                                                                             | **Hard stop — escalate first.** Read the `install.xml` comment before touching the copy steps                                               |
| Add a gate                                         | `scripts/beta-harness/`, then register in `verify-gate.mjs` `ALL_GATES`                                 | Watch it fail on purpose. Then re-run the full gate and re-cite in `.ai/state/phases.json` — adding a gate correctly turns `beta:state` red |
| Add a skill                                        | `.cursor/skills/<name>/SKILL.md`                                                                        | Reference it from the relevant `AGENTS/` file                                                                                               |
| Add a review agent                                 | `.claude/agents/<name>.md`                                                                              | Specify it in `AGENTS/12-review-agents.md` — that file wins                                                                                 |
| Add a generator                                    | `tools/satori-generators/src/<name>/` + `generators.json`                                               | `node scripts/build-platform-generators.mjs`; `beta:publishable` check 6 asserts it ships                                                   |
| Fix a bug                                          | Use the `fix-bug` skill                                                                                 | Add the pattern to `AGENTS/08-bug-patterns.md` if it is a _class_ of bug                                                                    |
| Work around an adf-hx defect                       | The code, **plus** a `WORKAROUND(adf-hx): W<n>` marker **and** a row in `docs/adf-hx-workarounds.md`    | Gated in **both directions** — a marker without a row or a row without a marker fails                                                       |
| Report an upstream adf-hx bug                      | `docs/adf-hx-upstream-findings.md`                                                                      | Needs a version, a file path and a reproduction. Keep our own environmental problems out of it                                              |

---

## 2. How a request travels

Traced with browse as the example:

| Step                                            | File                                                          |
| ----------------------------------------------- | ------------------------------------------------------------- |
| 1. User navigates `/#/browse`                   | `apps/nuxeo-ui/src/app/app.routes.ts`                         |
| 2. `authGuard` → `AuthService.ensureHydrated()` | `apps/nuxeo-ui/src/app/auth/auth.guards.ts`                   |
| 3. Component lazy-loads                         | `libs/features/browse/src/lib/browse/browse.ts`               |
| 4. Component calls a shared service             | `libs/shared/nuxeo-client/src/lib/services/browse.service.ts` |
| 5. Service builds the request                   | same file                                                     |
| 6. Interceptor adds `Authorization`             | `apps/nuxeo-ui/src/app/auth/nuxeo-auth.interceptor.ts`        |
| 7. Dev proxy forwards `/nuxeo` → `:8080`        | `apps/nuxeo-ui/proxy.conf.json`                               |
| 8. Response mapped to a model                   | `libs/shared/nuxeo-client/src/lib/models/`                    |
| 9. `signal()` updated, template renders         | `browse.ts` / `browse.html`                                   |
| 10. Extension columns resolved by ID            | `provide-app-extensions.ts:93` → `browse.ts:373`              |

---

## 3. Where things live

| Concern                 | Location                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Business logic          | The feature library, or `libs/shared/nuxeo-client` if it is repository semantics                       |
| Integrations            | `libs/shared/nuxeo-client` (Nuxeo), `ai-client` (AI ops), `kd-client` / `ke-client`                    |
| Prompts / instructions  | `AGENTS/*.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, `.windsurfrules`, `.github/copilot-instructions.md` |
| Procedures for AI tools | `.cursor/skills/*/SKILL.md`                                                                            |
| Review agents           | `.claude/agents/` — specified in `AGENTS/12-review-agents.md`                                          |
| Configuration (runtime) | `bootstrap.json` → `libs/shared/app-config`                                                            |
| Configuration (build)   | `angular.json`, `nx.json`, `tsconfig.base.json`, `eslint.config.mjs`                                   |
| Unit tests              | Beside the code, `*.spec.ts`                                                                           |
| E2E tests               | `apps/nuxeo-ui-e2e/src/`                                                                               |
| Evidence steps          | `scripts/beta-harness/steps/`                                                                          |
| Gates                   | `scripts/beta-harness/`                                                                                |
| Machine state           | `.ai/state/` — only through the gates                                                                  |

---

## 4. How to add a new feature library

`AGENTS/04-feature-scaffold.md` is the procedure. The parts people get wrong:

1. **Tag it.** `scope:features` + `type:feature` in `project.json`. Untagged means it cannot
   depend on anything.
2. **Add the tsconfig path alias** in `tsconfig.base.json`, sorted.
3. **Declare `lint` explicitly** in `project.json`. `@nx/eslint/plugin` infers a target named
   `eslint:lint`, which `nx affected -t lint` does **not** match — that left six projects
   unlinted for months.
4. **Give it a `test` target with a `reportsDirectory`**, or the coverage ratchet cannot see
   it. Then run `npm run beta:coverage -- --update-baseline` in the same commit, or the gate
   fails as unratcheted.
5. **Route it** in `app.routes.ts`.
6. **Write a spec that asserts observable state**, not that a function was called.

---

## 5. How to debug

### An agent-produced change that "works" but does not

The most common failure in this repository. Ask, in order:

1. **Does the assertion assert the claim, or the pulse?** A check on the app shell proves the
   app booted. `npm run beta:audit`.
2. **Is the registration real, or in a comment?** Assert **registry state**:
   `expect(TestBed.inject(ExtensionActionRegistry).has('acme.actions.export')).toBe(true)`.
3. **Is the rule assertion `false`?** An _unregistered_ rule ID also evaluates to `true`, so
   `toBe(true)` passes whether or not registration happened.
4. **Did the gate ever fail?** Break it deliberately. Three gates were green while the thing
   they guarded was broken.
5. **Is it type-safe?** A green `test` says nothing. Run `typecheck`.

### An application failure

| Symptom                                           | First look                                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `NG0201: No provider`                             | An upstream `providedIn: 'root'` service resolving a port from the root injector. Provide it in root                             |
| Raw i18n keys on screen                           | A catalogue missing or empty in the bundle. `npm run beta:bundle`                                                                |
| Empty lists, intermittent 403                     | XHRs unauthenticated. Session in `sessionStorage` satisfies the _guard_; `httpCredentials` authenticates _requests_. Both needed |
| Broken image, or an internal URL in the DOM       | `<img [src]>` bound to a Nuxeo URL. `checkNoNuxeoUrlInImgSrc`                                                                    |
| Memory growth over a session                      | An un-revoked blob URL. `checkBlobUrlLifecycle`                                                                                  |
| A nav entry that goes to the wrong page           | A registered path with no route — it falls through the wildcard. The host must map the path                                      |
| HTTP 500 from `AI.*`                              | The AI backend package is absent. Expected                                                                                       |
| Specs fail with `SecurityError` on `localStorage` | Node 22+. Use Node 20 or `npm run beta:gate`                                                                                     |

### Getting a trace out of E2E

```bash
npx playwright show-trace dist/e2e/artifacts/<test-dir>/trace.zip
```

Traces, video and screenshots are retained **on failure only**.

---

## 6. How to validate a change

```bash
npm run beta:gate -- --gates lockfile,guardrails,lint     # seconds
npm run beta:gate -- --phase my-change                    # all 15
npm run beta:e2e                                          # needs the live stack
gh run list --branch <branch> --limit 3 --json status,conclusion,headSha,event
```

**Only a CI run is authoritative.** Local gates run on your Node; CI runs on the pinned one.

---

## 7. Traps, ranked by how much they have cost

1. **A bare `npm install` on macOS** prunes Linux-only optional entries and breaks `npm ci`
   on CI. Cost: one phase of red CI.
2. **A green `test` is not type safety.** Vitest strips types.
3. **A gate you have not watched fail** is not evidence. Seven were found asserting less than
   they claimed.
4. **`eslint:lint` vs `lint`.** Inferred target names do not match `-t lint`.
5. **Reserved extension IDs are not extension points.** Four of eight slots were read by
   nothing when this was written; every slot now has a host, and there are nine
   (`docs/extension-reference.md` section 2 is the gated inventory). The principle stands.
6. **`withHashLocation()`** makes `goto('/#/x')` same-document — `APP_INITIALIZER` never
   re-runs.
7. **`provideAppInitializer` callbacks run concurrently.** A one-shot config read races the
   loader.
8. **Prettier will reformat a generated snapshot** and silently corrupt it. `docs/api/platform.api.md`
   is in `.prettierignore` for that reason.
9. **`libs/platform/tsconfig.lib.json` is the entire compiler config**, not overrides. Two
   defects came from options being _absent_.
10. **Evidence lives outside the repo** (`~/Desktop/agentic-ui-evidence/`). Anything
    load-bearing belongs in the repo docs.
