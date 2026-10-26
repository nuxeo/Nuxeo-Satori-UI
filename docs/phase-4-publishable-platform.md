# Phase 4: Layer 2 — Publishable Platform

**Status:** COMPLETE — all five deliverables shipped and verified
**Estimated:** 11-16 days with AI support
**Started:** 2026-08-23 · **Completed:** 2026-08-23

## Goal

Ship the platform as an installable npm package customers can extend from their own
code, without forking it.

## Key Deliverables

| #   | Deliverable                                                             | Status                                                                                |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Libraries build to `dist/` as an installable package                    | **done** — `@nuxeo/satori-platform`, installed from a tarball and typechecked against |
| 2   | Public API surface declared and pinned against accidental change        | **done** — `docs/api/platform.api.md`, 233 symbols, gated                             |
| 3   | Registration API — our `setComponents` / `setEvaluators` / `setActions` | **done** — `provideSatoriExtensions()`, 8 specs, and the app uses it                  |
| 4   | Thin forkable app template                                              | **done** — `apps/nuxeo-satori-template`, 401 kB, a working Nuxeo client (§4)          |
| 5   | Customer extension library starter                                      | **done** — Nx generator, output integrated with zero platform edits                   |

## 1. The package

**`@nuxeo/satori-platform`** — one versioned package, five entry points:

| Import specifier                      | What it is                                          |
| ------------------------------------- | --------------------------------------------------- |
| `@nuxeo/satori-platform`              | `PLATFORM_ENTRY_POINTS`                             |
| `@nuxeo/satori-platform/extensions`   | Layer 1/2 — slots, rules, actions, registration     |
| `@nuxeo/satori-platform/app-config`   | Layer 0 — bootstrap config and the runtime manifest |
| `@nuxeo/satori-platform/nuxeo-client` | Nuxeo REST services and document models             |
| `@nuxeo/satori-platform/ui`           | Shared components and dialogs                       |

```bash
npx nx build platform     # -> dist/libs/platform
```

### Why one package, not four

The distribution model in `docs/adf-hx-beta-plan.md` promises an upgrade is "an npm
version bump for the platform" — singular. Four independently versioned packages make
that four bumps and a cross-compatibility matrix to support. It is also the shape
`@alfresco/adf-hx-content-services` ships in, which this codebase already consumes.

### No files were moved

ng-packagr accepts a secondary entry point whose `entryFile` points **outside** the
package root — established by probe before relying on it. So `libs/platform/*/ng-package.json`
reference the existing `libs/shared/*/src` sources and a 200-file move was avoided.
The same probe confirmed sibling entry points may import each other by published
subpath, and that the specifier is preserved rather than inlined.

### Publish is blocked on purpose

`private: true`, no `publishConfig`. The `@nuxeo-satori` scope is unconfirmed
(risk **R10**), so the package is installable from a tarball or a path today and
cannot be pushed to a scope we may not own. One field flips when ownership is settled.

## 2. The API surface gate

```bash
npm run beta:api              # check, non-zero on drift
npm run beta:api -- --update  # regenerate the snapshot
```

Reads the **built** `.d.ts` files — the bytes a customer installs, not the source —
and compares against `docs/api/platform.api.md` (233 symbols across 5 entry points).
Wired into `npm run beta:gate` as the `api-surface` step, after `build`.

Nothing else in the repo can see a surface change: lint, test, build and typecheck are
all happy when a library gains or loses an export, because every in-repo caller is
updated in the same commit. The break lands on the customer a release later.

**Not `@microsoft/api-extractor`**: another lockfile dependency, wants a single
rolled-up entry point where this package ships five, and is markedly harder to break
on purpose — which every gate here has to clear.

**What it does not check:** names, kinds and signatures only. Angular decorator
metadata — a selector, an input alias — is invisible to it. A green check is not a
promise of backwards compatibility.

## 3. The registration API

`provideSatoriExtensions()` — one declarative object reaching all four registries,
applied in an environment initializer so every ID is registered before the first slot
resolves.

```ts
provideSatoriExtensions({
  slots: { navbar: NAV_ITEMS }, // typed const, not an inline literal
  rules: { 'acme.rules.isPilot': () => true },
  failClosedRules: ['acme.rules.isPilot'],
  components: { 'acme.sidebar.reports': () => import('./reports').then((m) => m.Reports) },
  actions: { 'acme.actions.export': { execute: (ctx) => void ctx } },
});
```

Four properties, each pinned by a spec:

- **The factory form gets an injection context** — `provideSatoriExtensions(() => ({...}))`
  may `inject()`. Not optional in practice: two of the application's own rules close
  over `AuthService`.
- **Later wins per ID** for rules, components and actions — how a customer overrides a
  packaged one without forking.
- **Slot descriptors accumulate**, so a customer adding a toolbar button cannot
  silently delete the packaged ones.
- **Returns `EnvironmentProviders`**, so it cannot be listed in a component's
  `providers`, where it would run too late to matter.

### A sharp edge worth knowing

`slots` is typed `Record<ExtensionSlotId, readonly ExtensionElement[]>`, and
`ExtensionElement` carries only `id`, `disabled` and `order`. An **inline** literal
with `label`/`path`/`icon` is a fresh object literal, so excess property checking
rejects it with **TS2418**. Assigning an already-typed `readonly NavItemDescriptor[]`
is fine. ACA's own `ExtensionElement` has no index signature either, so the contract
is right and the inline literal is wrong — hoist to a typed const. The template and
the generator both do this and say why.

## 4. The app template

`apps/nuxeo-satori-template` — a real Nx project, so `nx run-many` builds and
typechecks it and it cannot rot into a template that no longer compiles.

**401 kB initial / 108 kB compressed**, against the product's 3.5 MB. No adf-hx, no
Angular Material — because a fork should not have to remove our design system before
adding its own. The production budget is 450 kB warning / 700 kB error so a fork that
pulls in something heavy is told at build time.

### It is a working Nuxeo client, not a diagnostics harness

The first cut of the template did **not talk to Nuxeo at all**: its two pages were a
diagnostics page and a demo panel, and its manifest request 404ed against nothing. It
demonstrated the extension contract and nothing about building a content application,
which is most of what a customer actually has to do.

It now signs in and reads the repository, using `@nuxeo/satori-platform/nuxeo-client`
and no adf-hx:

| Route              | What it does                                                                     |
| ------------------ | -------------------------------------------------------------------------------- |
| sign-in (no route) | `GET /nuxeo/api/v1/me` with a typed credential; the shell gates the outlet on it |
| `/documents`       | `BrowseService.getBrowseFolderContents()` — folders, breadcrumbs, Dublin Core    |
| `/documents/:uid`  | `DocumentDetailService.getFullDocument()` plus `fetchBlob()` for the file body   |
| `/search`          | `SearchService.search({ ecmFulltext })` — the `default_search` page provider     |
| `/home`            | `inventory()` and `diagnostics()` — every registered ID, and what fell back      |

Three things a fork has to get right, which the template now shows rather than
describes:

- **Authentication is the host's job.** `NuxeoApiBase` never sets an `Authorization`
  header, because only the host knows whether it is doing Basic, SSO or a token.
  `template-nuxeo-auth.interceptor.ts` is the one place this application signs a
  request, and it filters on the resolved path so `bootstrap.json` — fetched before
  sign-in, from the app's own origin — never carries a credential.
- **The session must survive a reload**, or Layer 1 cannot work at all. The manifest
  is fetched from Nuxeo during `provideAppInitializer`, before any component exists;
  with no credential Nuxeo answers 403 and the manifest silently falls back. The
  template keeps a session in `sessionStorage` for exactly this reason, and the shell
  prints which source won.
- **Layer 0 chooses where Nuxeo is.** `nuxeoApiOrigin` is provided as
  `NUXEO_API_ORIGIN`. Empty means same-origin, which is correct behind
  `proxy.conf.json` under `nx serve` and for a Nuxeo-served deployment. A cross-origin
  value needs CORS on Nuxeo — the stock Docker image sends none, verified with
  `curl -H 'Origin: …'`, so a statically served bundle must sit behind a proxy.

| Layer | Where                                       | What it demonstrates                                   |
| ----- | ------------------------------------------- | ------------------------------------------------------ |
| 0     | `public/agentic-ui-config/bootstrap.json`   | branding, theme tokens and the API origin; reload only |
| 1     | `public/agentic-ui-config/manifest.json`    | `overrides` relabel, reorder and hide navigation       |
| 2     | `src/app/extensions/template-extensions.ts` | all five contribution kinds, in the factory form       |

Both files are the configuration servlet's envelope, standing in for it under `nx serve`; the
template's manifest has no fragments. `manifest.example.json` is a Layer 1 fragment to add there
— on a server, to a configuration package — and is not loaded from the bundle.

The nav is **resolved from the registry**, not written in the template — that is what
makes it addressable. The brand is read from Layer 0 too; it used to be the literal
string "Nuxeo Satori" in `app.html`, so a rebrand changed the tab title and the
palette while the one word a viewer looks at stayed put.

### Running it against a local Nuxeo

```bash
node tools/video/mock-customer/seed-nuxeo.mjs   # writes the demo workspace + config doc
npx nx serve nuxeo-satori-template              # proxies /nuxeo to localhost:8080
```

### Does it fall back to a default if a customer has no design system?

Yes. It ships ~150 lines of plain CSS and every one of its `var()` uses carries an
inline fallback, so it renders even with `styles.scss` deleted. What it does not ship
is a component library: `@nuxeo/satori-platform/ui` needs Angular Material (already a
declared peer). The chain is **template CSS built in → add Material + `/ui` → replace
with your own**.

## 5. The extension library generator

```bash
npx nx g ./tools/satori-generators:extension-library acme-extensions --owner=acme
```

Generates 14 files: the provider, a rules service, a component contributed by ID, six
specs, and the config to make it a first-class Nx project with `test`, `lint` and
`typecheck`. Registers the import alias in `tsconfig.base.json`.

**The generated spec is the point.** The failure it prevents is a library that
registers descriptors nothing renders — Phase 1 nearly shipped exactly that — so the
specs assert observable registry state. One asserts a rule evaluates **false** on
purpose: an unregistered rule ID evaluates to `true` because rules fail open, so a
test expecting `true` would pass even if registration never happened.

### The zero-edit claim, proven from git

Integrating the generated library touched **two** things: one line plus an import in
the template's `app.config.ts`, and one alias line in `tsconfig.base.json` written by
the generator. **No file under `libs/shared/` or `libs/platform/` was modified.**

In a browser against the production build, nav renders `[Home, Reports, AcmeExtensions]`
and `inventory()` lists `acme.navbar.acmeExtensions` and `acme.rules.canUseAcme`. The
provider stays wired into the template so CI keeps proving this end to end; the call
site says to delete it in a fork.

## Defects found by verifying rather than trusting

Recorded because each was invisible to a green build.

| #   | Defect                                                                                                                                                                                                                                                                                                           | How it was caught                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | `@agentic-ui/shared/extensions` is an **invalid npm name** — two slashes. Phase 4 was unshippable as specified, and no document recorded it.                                                                                                                                                                     | Checking name validity before packaging     |
| 2   | `@nx/angular:ng-packagr-lite` **ships a broken package** — skips FESM bundling while the exports map points at `./fesm2022/*.mjs`; all four subpaths were unresolvable.                                                                                                                                          | `npm pack` → install → resolve              |
| 3   | `npm install` **pruned the two Linux-only lock entries** named in CLAUDE.md, reproducing the fault that kept CI red for all of Phase 2.                                                                                                                                                                          | Diffing against a known-good lock           |
| 4   | The API surface extractor **silently omitted `export type { T }`** declarations, so `PlatformEntryPoint` was absent and its removal would not have been caught.                                                                                                                                                  | Reading the built `.d.ts` by hand           |
| 5   | The template's `themes` / `defaultThemeId` were **inert** — both keys present, a comment claiming "no rebuild needed", nothing reading them.                                                                                                                                                                     | Asking whether the default actually applies |
| 6   | The template's `documentTitle` **never applied** — `provideAppInitializer` functions run concurrently, so it read config before `load()` resolved.                                                                                                                                                               | Browser probe                               |
| 7   | The generated provider was named **`provideAcmeExtensionsExtensions`**, with a selector of `acme-acme-extensions-panel`.                                                                                                                                                                                         | Running the generator                       |
| 8   | Generated code was **not lint-clean** (`console.info` trips `no-console`).                                                                                                                                                                                                                                       | `nx lint` on the output                     |
| 9   | The platform package was compiled **without `strictNullChecks`** — `libs/platform/tsconfig.lib.json` extends `tsconfig.base.json`, which does not set `strict`; every other library sets it in its own tsconfig. 27 public types shipped wrongly non-nullable.                                                   | `fork-simulation`, first run                |
| 10  | The `api-surface` gate recorded **233 names and zero signatures**. Rolled-up `.d.ts` declarations carry no `export` prefix, so every regex missed and everything fell through to a name-only fallback — it reported `pass` while defect 9 changed 27 types.                                                      | Fixing 9, then watching the gate not notice |
| 11  | The gate **corrupted its own baseline on the first commit**. The snapshot is a `.md` file, lint-staged runs prettier on `*.md`, and prettier rewrote quotes, indentation and long type-argument wrapping inside the fenced blocks — 476 lines "changed", none real.                                              | Running the gate after committing it        |
| 12  | The generated library's navbar entry pointed at `/acme-extensions` with **nothing routed there**, so it fell through the wildcard to `/home` — a nav entry that goes nowhere.                                                                                                                                    | Clicking the link in the evidence run       |
| 13  | `ExtensionOutletComponent` **crashed** with `Object.entries(undefined)` as a route component. `withComponentInputBinding()` sets every declared input from route data, passing `undefined` for omitted keys, which defeats the input's `{}` default. Reachable from the product too, which uses the same option. | Phase 4 evidence run, step 12               |

Defects 9 to 11 compound, and that is the point worth keeping: a misconfigured
tsconfig shipped 27 wrong types, the gate meant to catch surface changes could not see
them, and the gate's own baseline was being rewritten by a formatter on every commit.
Three green signals, one real defect underneath.

### One guardrail widened, and re-broken to prove it still bites

`checkThemeTokens` required a colour literal to sit on a line referencing
`--mat-sys-*` or `--kd-*`. The template ships no Material by design, so `--mat-sys-*`
is undefined there and `var(--mat-sys-surface, #fff)` would have satisfied the gate
while the fallback did all the work — the tautological gate this repo has already paid
for twice. `--shell-*` is now recognised as a third themed namespace, legitimate
because `TemplateThemeService` genuinely applies Layer 0 tokens to it. Custom property
_declarations_ are exempt, narrowly. Verified afterwards that a plain `color: #ff0000`
and an `rgba()` are both still caught.

## Verification

```bash
npm run beta:gate -- --phase phase-4-signoff                    # 11/11 green
npx nx run-many -t typecheck build test --all --skip-nx-cache   # 22 projects green
npm run beta:state                                              # pass
APP_URL=http://127.0.0.1:4321 npm run beta:evidence -- phase-4-platform   # 25/25
```

22 projects, up from 20 — the template and the generated library are both under CI.

**Signed off on evidence, not on prose.** `phase-4-platform/2026-08-23T03-22-29` —
25 checks across 12 steps against the built template and the built package, with 3
distinct screenshots. `.ai/state/phases.json` records it `complete` and `beta:state`
passes; for two commits that file said `in-progress` while this document's header
said COMPLETE, which is recorded as a deviation rather than quietly corrected.

### CI now runs what the local gate runs

Before this phase closed, `ci.yml` ran 5 checks against the local gate's 11 — so
neither `api-surface` nor `fork-simulation` could protect `main`, and **`typecheck`
never ran in CI at all**. Given that `test` strips types through esbuild and most
libraries have no `build` target, a type error confined to a library reached `main`
unless `nuxeo-ui`'s build happened to import it. All three are now CI steps, ordered
before the bundle-size step because that step begins with `rm -rf dist`.

## What is deliberately not done

- **Publishing.** Blocked on `@nuxeo-satori` scope ownership (R10).
- **`adf-hx-bridge` is not an entry point.** It would make adf-hx reachable from the
  package; the existing `checkNoAdfHxInPublicApi` guardrail enforces this.
- **Semantic compatibility checking.** The API gate is a shape gate; it does not read
  decorator metadata.
- **The template resolves platform imports through workspace tsconfig aliases to
  source**, not to the built package. Package consumability is covered separately by
  the tarball probe, but a fork swapping aliases for the npm dependency is not yet
  verified end to end.

## References

- Plan: `docs/adf-hx-beta-plan.md` Phase 4 section
- Package README: `libs/platform/README.md`
- API snapshot: `docs/api/platform.api.md`
- Layer 1 ID contract: `docs/extension-reference.md`
