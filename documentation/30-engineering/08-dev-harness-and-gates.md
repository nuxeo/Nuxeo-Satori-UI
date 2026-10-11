---
title: Dev Harness & Gates
parent: Engineering
order: 8
last_reviewed: 2026-10-09
repo_commit: effd434
audience: engineering
---

# The Development Harness and its Gates

> **Last reviewed:** 2026-10-09 · **Repository:** `effd434` (`feature/nxsat-308-satori-components`)
> Only "Hard floors, and where it runs" was re-verified at that commit. The gate inventory (§2 and
> §7) — 27 gates, including the `dependency-tree` pair (gates 4 and 5) that NXSAT-308 adds — was
> re-verified on 2026-10-08 at `fb97d44`, before `peer-installability` (gate 22) joined it. §3, §8, the `supply-chain` and `guardrails` rows of §2 and
> the CI-only rows of §7 were re-verified on 2026-10-08 at `2898046`
> (`feature/nxsat-308-ci-cold-cache-tooling`) against `GUARDRAILS`, `supply-chain.mjs` and
> `.github/workflows/`; §3's three `checkSatoriComponents*` rows and §8's `integration/**` push
> triggers were added on 2026-10-09, when `main` was merged into `integration/nxsat-308`. The rest
> of the page as of 2026-10-05 · `b32d4c8` — the revision that implements the 24-gate set and the
> 23-control lockfile suite described below.
> This is the **development-time** harness. For the customer-facing runtime AI features see
> [Runtime AI Features](10-runtime-ai-features.md).

---

## 1. What this is, and why it exists

The product was built largely by AI coding agents. That works, and it produces a specific
failure mode: **an agent will report success, and the report will be wrong in a way that
passes every check it knows about.**

Not hypothetically. In this repository:

- Three generators spliced every registration **inside a comment**, reported success,
  printed the IDs they had "registered" — and lint, typecheck and six specs all passed.
- An evidence gate compared script `src` attributes instead of bundle bytes.
- A path check was tautological under the dev base href.
- A lockfile gate matched dependency names but not versions.
- A published package could not be published at all, for an entire phase, while six other
  gates were green.

So the harness is not a convenience. It is the mechanism that converts "the agent says it
works" into "here is an artifact that would have gone red if it did not". Its governing
rule:

> **A gate is not evidence until you have seen it fail on purpose.** Break it deliberately,
> watch it go red, then trust it.

Three gates in this programme were green while the thing they guarded was broken. Every gate
described below has a recorded negative control.

---

## 2. The gates

```bash
npm run beta:gate -- --phase <id>                      # every gate, cheapest first, stop at first failure
npm run beta:gate -- --gates lockfile,guardrails,lint  # fast inner loop
```

The authoritative count is the verdict line `beta:gate` prints — 26 on 2026-10-08 — which is why
the heading no longer carries one. The table below listed 17 while `ALL_GATES` held 23, having been
written before the self-test gates existed, and every heading count so far has broken the links to it.

Ordered deliberately: a lint error usually explains the test failure that would follow, and
running the full set on a known-broken tree wastes minutes per iteration.

| #   | Gate                       | Asserts                                                                                                                                                                                                                                                     | Why it exists                                                                                                                                                                                                                                     |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `node`                     | The runtime is one whose results mean anything                                                                                                                                                                                                              | An agent on the wrong Node major gets a red indistinguishable from a code defect, and the obvious response — edit the failing spec — damages working code. That happened                                                                          |
| 2   | `lockfile`                 | Every non-optional dependency edge resolves **within the lock**                                                                                                                                                                                             | The failure the other gates structurally cannot see. `npm ci --dry-run` only demands what the current platform resolves, so on macOS it never looks at the pruned Linux subtree                                                                   |
| 3   | `lockfile-selftest`        | The lockfile gate's own 23 controls — 14 negative, 9 positive                                                                                                                                                                                               | That gate has been wrong in both directions — names-not-versions, then waiving every `brace-expansion` major off a `^5.0.0`-scoped override — and both were found by a human reading it, not by anything that ran                                 |
| 4   | `dependency-tree`          | None of adf-hx, adf-core, adf-extensions, js-api or hxcs-js-client in the lock, the installed tree (`npm ls`), any manifest, `.npmrc` or an import under `apps/`/`libs/`. **Report-only** until the ADF removal commit sets `BLOCKING = true` in the script | NXSAT-308 criterion 3, "checked in CI". Report-only because all five are on `main` by construction and a permanently red gate gets bypassed — but it still fails on an uninspectable location, and on a clean tree whose switch was never flipped |
| 5   | `dependency-tree-selftest` | The dependency-tree gate's own controls, each negative one a single package or an inspection gap in a single location; the run prints how many are negative, quiet and listing                                                                              | A report-only gate passes whatever it finds, so without controls it could regress into finding nothing and stay green until the day it became blocking                                                                                            |
| 6   | `supply-chain`             | No production `high`/`critical`; acceptances dated and unexpired; no unimported production dependency, by **parsed** specifier                                                                                                                              | SCA was a human running `npm audit` and writing the number into a document. It also found `cors` and `dotenv` — two unused production dependencies nobody had recorded                                                                            |
| 7   | `code-scanning`            | The ref **was analysed**, and no CodeQL alert is unaccounted for                                                                                                                                                                                            | SAST was already running and finding 21 alerts, 6 high, that nobody read. The gap was never the tool — it was that no process consumed the output                                                                                                 |
| 8   | `guardrails`               | Every repo invariant registered in `GUARDRAILS` (`scripts/review-guardrails.mjs`) — see §3                                                                                                                                                                  |                                                                                                                                                                                                                                                   |
| 9   | `guardrails-selftest`      | The i18n guardrails' negative controls                                                                                                                                                                                                                      | Eleven guardrails shipped with no tests at all, and the controls found a defect in two of the three they cover — an unguarded `JSON.parse` that discarded every other guardrail's diagnostics                                                     |
| 10  | `crowdin-selftest`         | The Crowdin context-push and status scripts' controls                                                                                                                                                                                                       | Neither can be exercised end to end until a Crowdin project exists                                                                                                                                                                                |
| 11  | `sanitizer-audit`          | Every `bypassSecurityTrust*` is registered with a justification, no `Safe*` value reaches a `SecurityContext.NONE` binding, trusted HTML traces back to a sanitiser                                                                                         | XSS-adjacent debt was tracked in prose                                                                                                                                                                                                            |
| 12  | `sanitizer-selftest`       | The sanitizer audit's negative controls                                                                                                                                                                                                                     | Registered in ALL_GATES **and** in CI, after review pointed out that the gate guarding a shipped XSS-adjacent defect could not block a merge                                                                                                      |
| 13  | `assertions`               | Every evidence assertion is **capable of failing**                                                                                                                                                                                                          | Phase 1 shipped a defect past two checks that "certified properties they could not observe"                                                                                                                                                       |
| 14  | `lint`                     | Affected ESLint, incl. real module boundaries                                                                                                                                                                                                               |                                                                                                                                                                                                                                                   |
| 15  | `test`                     | Affected unit tests                                                                                                                                                                                                                                         | **Does not typecheck** — vitest strips types through esbuild                                                                                                                                                                                      |
| 16  | `build`                    | Affected builds                                                                                                                                                                                                                                             |                                                                                                                                                                                                                                                   |
| 17  | `typecheck`                | `ngc` per library                                                                                                                                                                                                                                           | Most libraries have no `build` target, so before this a type error confined to a library reached `main`                                                                                                                                           |
| 18  | `spec-types`               | Spec files typecheck — 22 projects                                                                                                                                                                                                                          | `typecheck` reads `tsconfig.lib.json`, which excludes `*.spec.ts` by construction, so no gate had ever type-checked a spec and 43 errors had accumulated                                                                                          |
| 19  | `bundle`                   | Banned symbols absent; required assets present **and non-empty**                                                                                                                                                                                            | Found adf-hx importing `ng-mocks` — a test library — into the shipped runtime bundle, with two `eval()` calls                                                                                                                                     |
| 20  | `api-surface`              | The published `.d.ts` matches a 2,221-line snapshot                                                                                                                                                                                                         |                                                                                                                                                                                                                                                   |
| 21  | `publishability`           | A real `npm publish --dry-run`, generators resolve, declarations typecheck standalone                                                                                                                                                                       |                                                                                                                                                                                                                                                   |
| 22  | `peer-installability`      | The built tarball installs from public npm with **no GitHub Packages credentials**; with the Satori peer made required, the same install fails                                                                                                              | Every other gate runs against this monorepo, whose `node_modules` already holds `@hylandsoftware/satori-ui`. A customer has no such tree, and npm installs every non-optional peer                                                                |
| 23  | `fork-simulation`          | The template compiles against the **built** package                                                                                                                                                                                                         |                                                                                                                                                                                                                                                   |
| 24  | `upgrade-rehearsal`        | A Layer 0/1/2 customisation survives a version bump                                                                                                                                                                                                         | The only gate that crosses a version boundary                                                                                                                                                                                                     |
| 25  | `reference-drift`          | The customer-facing extension reference agrees with the code                                                                                                                                                                                                | The only customer-facing document nothing checked                                                                                                                                                                                                 |
| 26  | `agent-mirror`             | `.claude/` and `.agent/` are byte-identical to `.cursor/`                                                                                                                                                                                                   | Three copies of every skill with nothing comparing them: a skill fixed in one tool's copy and stale in another is wrong only for whoever uses the other tool                                                                                      |
| 27  | `customer-guardrails`      | The guardrail we ship, run against our own reference library                                                                                                                                                                                                | A tool we hand customers and never run ourselves is one we would learn was broken from a customer's CI log                                                                                                                                        |

### Two traps that have each cost a phase

1. **A green `test` is not type safety.** Only `build` and `typecheck` catch a TS error.
2. **Nothing except `lockfile` checks that `package-lock.json` will install.** CI was red for
   the whole of Phase 2 while every local gate was green. (`dependency-tree` reads the lock too,
   but only for the names of five packages — it says nothing about whether the tree resolves.)

### What each gate caught — the honest ledger

| Gate                  | Live defect found                                                      | Hole closed before exploitation                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publishability`      | Package unpublishable (full compilation mode)                          | —                                                                                                                                                                                                                     |
| `lint` (boundaries)   | 4 real cross-boundary imports                                          | —                                                                                                                                                                                                                     |
| `api-surface`         | Blind to `const`/`type` bodies — a renamed slot ID read as "no change" | —                                                                                                                                                                                                                     |
| `fork-simulation`     | 27 wrongly non-nullable public types                                   | —                                                                                                                                                                                                                     |
| `bundle`              | `ng-mocks` + 2 `eval()` in the shipped bundle                          | i18n catalogue check asserted existence, not content                                                                                                                                                                  |
| `reference-drift`     | Reference wrong in both directions                                     | Treated a **comment** as code                                                                                                                                                                                         |
| `customer-guardrails` | —                                                                      | 3 of 5 checks satisfiable without doing the work                                                                                                                                                                      |
| `lockfile`            | CI red for a phase                                                     | Skipped 52 devDependency edges; then waived every `brace-expansion` major off a `^5.0.0`-scoped override — same defect class, opposite direction, which is why it now has 23 executable controls, 14 of them negative |
| `state-check`         | 6 phases citing an insufficient re-gate                                | Read `verdict` and not `totals.failed`                                                                                                                                                                                |

---

## 3. The commit-time guardrails

[`scripts/review-guardrails.mjs`](../../scripts/review-guardrails.mjs), run by the gate and by
CI. The checks are whatever its `GUARDRAILS` array registers — 39 at the commit in the banner,
listed here in that order. This section said "11 checks" while the array held 35: the table had
stopped at the general-purpose checks and every i18n and packaging check was added after it.

| Check                                         | Enforces                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `checkThemeTokens`                            | Colour literals come from a themed namespace with a fallback, or declare a `--*` token                                    |
| `checkDocsNumbering`                          | No duplicate `## n.` section numbers in `docs/`                                                                           |
| `checkNoReviewCorpusChurn`                    | Review bookkeeping does not travel in a pull request — the findings record lives on Confluence                            |
| `checkVitestProjects`                         | A project with an `@nx/vitest:test` target has a Vite config                                                              |
| `checkBlobUrlLifecycle`                       | Every file creating an object URL revokes one — **repo-wide**                                                             |
| `checkNoNuxeoUrlInImgSrc`                     | No `<img [src]>` bound to a Nuxeo URL                                                                                     |
| `checkNoAttrPrefixedLiteralAttributes`        | No `[attr.aria-*]`, `[attr.role]` or `[attr.title]` on a literal attribute — a silent accessible-name miss                |
| `checkTypeSafetyEscapes`                      | Warns on `as unknown as` / `as never`                                                                                     |
| `checkHardcodedSecrets`                       | Credential-shaped literals                                                                                                |
| `checkAngularDevAssets`                       | Dev-only assets do not ship                                                                                               |
| `checkAdfHxWorkaroundIds`                     | A `WORKAROUND(adf-hx): W<n>` marker has a register row **and vice versa**                                                 |
| `checkNoAdfHxInPublicApi`                     | No adf-hx type reachable through a library barrel, walking the re-export graph                                            |
| `checkNoHardcodedUiText`                      | No hard-coded user-facing string in any template, repo-wide                                                               |
| `checkNoHardcodedDescriptorText`              | No hard-coded label in a descriptor — nav entries, actions, columns — which the template check cannot see                 |
| `checkNoHardcodedDialogText`                  | No hard-coded title, message or button label in a dialog's data object                                                    |
| `checkNoHardcodedImperativeUiText`            | No hard-coded snackbar, toast or error text built in TypeScript                                                           |
| `checkTranslateIsInjectedWhereUsed`           | A class using `this.translate` injects `TranslateService` — otherwise a runtime crash on the first error path             |
| `checkCatalogueValuesAreRenderable`           | A catalogue value is the text a user sees — no HTML entities or markup copied from a template                             |
| `checkNoStaleAgnosticClaim`                   | A comment saying a library has no dependency on something is still true of that library                                   |
| `checkTranslationCatalogues`                  | Every `i18n/<locale>.json` parses to an object of keys and ends with a newline                                            |
| `checkCataloguesAreTranslated`                | A non-English catalogue translates something, rather than being a copy of `en.json`                                       |
| `checkCataloguePlaceholders`                  | A translation keeps every `{{ placeholder }}` its English source has, and adds none                                       |
| `checkAdvertisedLocalesShip`                  | Every advertised locale ships a catalogue, and the default is one of them                                                 |
| `checkCrowdinConfig`                          | `crowdin-conf.yml` exists, declares a source, and both sync workflows name it                                             |
| `checkPackagedConfigIsNotADemo`               | The packaged Marketplace config ships Nuxeo defaults, not a demo rebrand                                                  |
| `checkInstallerOwnsNoCustomerFile`            | The Marketplace package installs no configuration file, and no copy that refuses to overwrite                             |
| `checkTranslationContext`                     | Translator context exists for every string, and for no string that no longer exists                                       |
| `checkTranslatorNotesFlagProductsAndAcronyms` | Notes on strings naming a product say "do not translate", and notes on acronyms expand them                               |
| `checkPlatformEnglishFallback`                | The English `@nuxeo-satori/platform` ships matches the application's, for exactly the keys the package uses               |
| `checkTranslatorContextPush`                  | The translator-context push can reach every context file in the repository                                                |
| `checkNoProseInComponentInputs`               | No prose in a plain attribute on a component — it is an `@Input`, not HTML                                                |
| `checkNoTemplateSyntaxInDocumentShell`        | No Angular template syntax in `index.html`, which Angular never compiles                                                  |
| `checkNoRootAbsoluteShippedAssetPaths`        | A shipped asset is referenced relative to `<base href>`, never from the server root — the packaged app lives under a path |
| `checkShippedDefaultLanguage`                 | The shipped Layer 0 default language is a locale that ships — never the `zz` pseudo-locale                                |
| `checkAccessibleNameFallbacks`                | Every key bound to an accessible name survives a failed catalogue fetch                                                   |
| `checkLocaleDataRegistered`                   | Every locale with a catalogue has Angular locale data registered, so dates and numbers format in it                       |
| `checkSatoriComponentsDependencies`           | The `nxs-` library reaches no `@alfresco/*` or `@hylandsoftware/*`, directly or through anything it imports               |
| `checkSatoriComponentsEntryPoint`             | The `nxs-` library is imported only through `@nuxeo-satori/platform/components` — no deep path, no second alias           |
| `checkSatoriComponentsFederationReadiness`    | The `nxs-` library is standalone-only and has no `providedIn` singleton, so it survives a federation boundary             |

Two of these were **diff-scoped** until 2026-08-24, meaning every violation predating the
check was permanently exempt — not a rule, a rule for new code. Four real blob-URL leaks
lived behind that exemption while the gate reported pass on every run.

`checkNoAdfHxInPublicApi` walks the barrel's re-export graph to **depth**, because the leak
that cost 0.95 MB of initial bundle was two hops away: the barrel exported a providers file
which imported adf-hx.

The sanitiser pairing check is **no longer here**. It lived in this file as `checkSanitizerPairing`
and was superseded by `sanitizer-audit.mjs` **check 5**, which walks the TypeScript AST instead of
matching a regex — so comments are not code, and it catches the forms a regex cannot see at all
(`sanitizer['bypassSecurityTrustHtml']`, destructuring, aliasing, `.call()`). The reasoning it was
built on still stands: the safety of those calls is a **pairing**, not a property of either half, and
deleting one `sanitize()` would otherwise leave a compiling, passing, stored-XSS hole on a path that
renders `note:note`, which any user with write access can author.

**What that check does and does not cover, because the distinction was got wrong twice.** Check 5
fires on the presence of `bypassSecurityTrustHtml`. It therefore covers the render paths, and it
structurally cannot cover a function that sanitises and returns a plain string — `readQuillHtml()` in
`note-editor.ts` is exactly that, and it is the path that **persists** note HTML to Nuxeo. Until
2026-09-11 the `quill` acceptance in `.ai/state/supply-chain-allowlist.json` named this check as its
enforcement, which was wrong in both directions: the check had been renamed, and it never saw the
exporter. That mitigation is now covered by a test in `note-editor.spec.ts` that drives `onSave()`
with hostile markup and asserts what `saveNote` emits, confirmed to fail when the sanitise call is
removed. Do not describe check 5 as underwriting the whole acceptance; it underwrites one half.

---

## 4. The evidence system

Two separate systems, often confused.

### Phase evidence — `scripts/beta-harness/`

```bash
npx nx serve nuxeo-ui                    # separate terminal
npm run beta:evidence -- <phase-id>
```

[`phase-runner.mjs`](../../scripts/beta-harness/phase-runner.mjs) drives Playwright against
the live app, executing a per-phase **steps file** from
[`scripts/beta-harness/steps/`](../../scripts/beta-harness/steps). Exit codes: `0` pass,
`1` fail, `2` **precondition-not-met** — fix the environment, do not iterate on the code.

Every step must record **at least one check**, and every check must pass. A capture that
asserts nothing fails deliberately.

Helpers available to a steps file ([`helpers.mjs`](../../scripts/beta-harness/helpers.mjs)):
`step`, `check`, `screenshot`, `login`, `goToDoc`, `expectVisible`, `expectText`,
`expectNoConsoleErrors`, `expectNoA11yViolations`, `requirePrecondition`, `note`.

| Steps file               | Phase claim                                                                   |
| ------------------------ | ----------------------------------------------------------------------------- |
| `phase-0-baseline.mjs`   | The state before any Beta work                                                |
| `phase-0-no-backend.mjs` | The app degrades honestly with no backend                                     |
| `phase-1-config.mjs`     | Configuration alone changes the app, with no rebuild                          |
| `phase-2-registry.mjs`   | A manifest edit changes the addressable surface with no rebuild               |
| `phase-3-adf-hx.mjs`     | Written **before** the swap, recording the hand-written component's behaviour |
| `phase-3-search.mjs`     | Search against the real index                                                 |
| `phase-4-platform.mjs`   | The platform is an installable package a customer can fork against            |
| `phase-5-harness.mjs`    | Generators produce **live** registrations                                     |
| `phase-6-a11y.mjs`       | Three axe scans, ratcheted, plus keyboard reachability                        |
| `showcase-adf-hx.mjs`    | Not a gate — presentation screenshots                                         |

### Rules the evidence system enforces on itself

- **Evidence must assert the claim, not the pulse.** A falsifiable check on the app shell
  still only proves the app booted.
- Anything asserting a _reloaded_ app needs a real `page.reload()` — `withHashLocation()`
  makes `goto('/#/x')` same-document, so `APP_INITIALIZER` never re-runs.
- Console-error suppressions are listed in the audit output, because a suppression nobody
  has to look at is how a real regression stays invisible.
- `npm run beta:audit` statically classifies every assertion and fails any that cannot fail
  — literals, self-comparisons, `Boolean(constant)`, negated constants, missing conditions.
  257 assertions across 13 steps files at last run.

### Ticket evidence — `scripts/collect-evidence/`

~20 runners, one per Jira ticket (`NXSAT-151` … `NXSAT-201`), each capturing before/after
for a specific bug fix — largely Nuxeo Web UI parity gaps. Run via
`npm run evidence:collect`. Evidence is written **outside the repo** to
`~/Desktop/agentic-ui-evidence/`, so it does not travel with a clone. **Anything
load-bearing belongs in the repo docs.**

---

## 5. Phase state — the anti-false-completion control

`.ai/state/phases.json`, checked by
[`state-check.mjs`](../../scripts/beta-harness/state-check.mjs).

```bash
npm run beta:state
```

A phase may claim `complete` only if its cited manifest exists, says `pass`, records
non-zero checks, has `totals.failed === 0`, and cites a gate report that is `pass` — not
`pass-partial`.

It exists because Phase 1 was recorded complete, in prose and in the agent contract, and
used to downgrade a risk, while its upgrade-safe config path was wrong by one segment and
"would have 404'd on every install". Nothing mechanically connected the claim to an
artifact.

It is deliberately sceptical of its own inputs: evidence lives outside the repository,
unversioned and writable, so a `verdict: pass` alongside `totals.failed > 0` is reported as
a **doctored manifest** with the instruction to re-run the phase rather than reconcile the
numbers.

Adding a gate correctly turns it red — every phase then cites a re-gate with a smaller gate
count. That has happened twice and the gate was right both times. Re-run the full gate and
re-cite; do not relax the check.

---

## 6. The coverage ratchet

```bash
npm run beta:coverage                     # check
npm run beta:coverage -- --run            # run the tests first
npm run beta:coverage -- --update-baseline
```

The Beta bar is >90%. Nothing is near it, so a gate set at 90% would be red on every run —
and _a gate that cannot pass gets bypassed and then ignored, which is worse than no gate_.
So it **ratchets**: it records where each project is and fails when one goes backwards,
while reporting how far each still is from 90% so the debt stays visible.

It also fails on:

- an **orphaned** baseline entry — a project the workspace no longer has. One lingered for
  a deleted library, reported forever as "not measured, unchanged";
- an **unratcheted** project — measured but absent from the baseline, previously printed as
  `new` and then excluded from every check, so a new library's coverage could fall to zero
  silently.

### Hard floors, and where it runs

A project named in `FLOORS` is held to a fixed floor on every run instead of the ratchet:
`satori-components`, the `nxs-` library NXSAT-308 builds new, at 90% of lines from its first
commit. Lines are counted as istanbul counts them — distinct statement start lines, covered if any
statement on the line ran — and compared as counts, not a rounded percentage. The floor also fails
when that project was not measured, when its report is stale (older than its source, or counting
a source file that has since been deleted), and when any of its files sits outside the
measurement — v8 lists a file no spec imports with an empty statement map, so it cannot lower a
percentage. Only `noStatements` files are excused, never a dated allowlist entry. Seen red before
it was trusted: an untested function (83.33%), an untested component file (the percentage stayed
at 100%; the floor did not), that file with a dated allowlist entry, a report of nine covered
statements on one line and one uncovered on the next (90% of statements, 50% of lines), and a
report lifted to 90% by a deleted file.

The gate runs at the end of the SonarCloud workflow, reading the `coverage-final.json` files its
test-with-coverage step already wrote. Before that it ran in no workflow and was not in
`beta:gate`, so nothing enforced it.

### A defect in the numbers — fixed 2026-08-24

`tasks` and `assets` have **zero spec files** and were recorded at **100%**. Their coverage
reports contain 4–5 files and **0 total statements**, and the summariser computed 0/0 as 100%,
so both were counted as meeting the Beta bar.

`core` was reported alongside them as having no specs. **That was wrong** — it has one, the
generated `should create` spec, and its 100% is truthful. It is simply an untouched Nx scaffold:
a placeholder component with an empty template, **7 statements**, imported by nothing.

The gate now distinguishes three states rather than two:

| State            | Meaning                                              | Counted towards the bar |
| ---------------- | ---------------------------------------------------- | ----------------------- |
| **measured**     | a real percentage over real statements               | yes                     |
| **thin**         | meets the bar over fewer than 20 statements — `core` | yes, but flagged        |
| **unmeasurable** | a report with zero statements, or no specs at all    | **no**, and it fails    |

A baseline entry for an unmeasurable project now **fails** the gate, because that entry is the
defect: `--update-baseline` prunes it, and until then the gate names it. The table also prints
the **statement count and spec count** next to every percentage — a percentage without its
denominator is what made this possible, and `core`'s 100% over 7 statements read identically to
`shared-app-config`'s 100% over 428.

**The true figure: 15 projects are measurable, 4 meet 90%, and 3 do so substantively**
(`shared-app-config` 428 statements, `shared-extensions` 480, `permission-dialogs` 439). Any
statement of the form "5 of 17 meet the bar" — including one written into the plan and delivery
record on 2026-08-24 — **overstated**, and `assets` and `tasks` are untested rather than
perfect. Both documents are corrected.

Two consequences worth separating, from `nx graph`:

- **`assets` and `tasks` are consumed by `nuxeo-ui`.** They are shipping features with **no
  tests at all** — a worse finding than the reporting defect that concealed them, and squarely
  Phase 6 step 6 work.
- **`core` has no inbound dependencies.** Nothing in the workspace imports `@agentic-ui/core`.
  It is a generated scaffold that was never used, and deleting it would remove the only thin
  entry from the table. Left in place for now, recorded as debt rather than quietly pruned.

---

## 7. What runs where

| Gate                                                                                 | Local gate | PR CI | Notes                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | :--------: | :---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| node                                                                                 |     ✅     |   —   | `setup-node` pins the runner to `node-version: 20`, which is the stronger equivalent                                                                                                                                          |
| lockfile, lockfile-selftest                                                          |     ✅     |  ✅   | Added 2026-10-05. `npm ci` proves the lock installs on Linux but says nothing about the gate still being able to report, and that half had been wrong twice                                                                   |
| dependency-tree, dependency-tree-selftest                                            |     ✅     |  ✅   | Added 2026-10-08, in both from the first commit. Report-only until the ADF removal commit; CI runs it after `npm ci`, so the installed tree it reads is the one the lock produced                                             |
| supply-chain                                                                         |     ✅     |  ✅   | Added to CI 2026-08-24                                                                                                                                                                                                        |
| code-scanning                                                                        |     ✅     |   —   | CodeQL **analysis** runs as its own workflow; the gate that reads the alerts needs `gh` and a token, so it runs locally                                                                                                       |
| guardrails, guardrails-selftest, crowdin-selftest                                    |     ✅     |  ✅   | The self-tests are the basis for trusting the guardrails, so running them is not optional                                                                                                                                     |
| sanitizer-audit, sanitizer-selftest                                                  |     ✅     |  ✅   | Both were in ALL_GATES and in `review:preflight` while CI invoked neither — "registered as a gate" meant local-only                                                                                                           |
| assertions, reference-drift, customer-guardrails                                     |     ✅     |  ✅   | Added to CI 2026-08-24                                                                                                                                                                                                        |
| lint, test, build, typecheck                                                         |     ✅     |  ✅   |                                                                                                                                                                                                                               |
| spec-types                                                                           |     ✅     |   —   | Not in `ci.yml`. A spec type error reaches `main` unless someone ran the local gate                                                                                                                                           |
| bundle                                                                               |     ✅     |  ⚠️   | **Only when `nuxeo-ui` is affected** — it needs the production build. Added to CI 2026-08-24                                                                                                                                  |
| api-surface, publishability, peer-installability, fork-simulation, upgrade-rehearsal |     ✅     |  ✅   | Run unconditionally — they catch the expensive class                                                                                                                                                                          |
| agent-mirror                                                                         |     ✅     |   —   | Not in `ci.yml`, so `.claude`/`.agent` drift from `.cursor/` is caught only locally                                                                                                                                           |
| **E2E**                                                                              |     ✅     |  ❌   | Needs Docker Nuxeo + a served app. **A real limitation**                                                                                                                                                                      |
| **Phase evidence**                                                                   |     ✅     |  ❌   | Needs a live backend                                                                                                                                                                                                          |
| Registry auth, cold cache                                                            |     —      |  ⚠️   | Its own workflow, `registry-auth.yml`: daily, and on PRs touching `package.json`, `package-lock.json` or `.npmrc`. Not a local gate — it needs the token and a ~30 s uncached install; run it with `npm run ci:registry-auth` |
| review-harvest and Confluence link controls                                          |     —      |  ✅   | Offline selftests for two tools that otherwise run only with credentials CI does not have                                                                                                                                     |
| Bundle **size** ceiling                                                              |     —      |  ✅   | 6 MiB total shipped JS+CSS. CI-only, so it has no local equivalent                                                                                                                                                            |

**CI runs 23 of the 27**, one of them (`bundle`) conditionally. The four it does not run are
`node`, `code-scanning`, `spec-types` and `agent-mirror`. Read that from `ci.yml` against
`ALL_GATES` rather than from this paragraph: every count in this file has been wrong at least once.
Earlier on 2026-08-24 CI ran **8 of the then-15**, so "green locally" and "green in CI" made
different claims and neither disclosed it; four were added that day with `supply-chain`, the
sanitizer pair followed, `lockfile` with its controls on 2026-10-05, and `dependency-tree` with
its controls on 2026-10-08.

`beta:audit-selftest`, `review:analysis-selftest` and `docs:links-selftest` also run in CI and are
**not** in `ALL_GATES`, so they are not counted above —
CI is not a strict subset of the local gate set in either direction.

---

## 8. GitHub Actions — 16 workflows

| Workflow                | Trigger                                                                                                            | Does                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | push to `main`/`feature/**`/`fix/**`/`integration/**`, PR                                                          | guardrails, static gates, tooling controls, lint, test, typecheck, published-package gates, bundle size          |
| `registry-auth.yml`     | daily 05:17 UTC, manual; PR and push to `main` touching `package.json`, `package-lock.json`, `.npmrc` or the check | Cold-cache `npm ci` against GitHub Packages — fails on a revoked token that `ci.yml`'s cached install cannot see |
| `a11y.yml`              | push to `main`/`feature/**`/`fix/**`/`integration/**`, PR, manual, reusable                                        | Static accessibility scan of the templates                                                                       |
| `codeql.yml`            | push to `main`/`integration/**`, PR, weekly Fri 06:22 UTC                                                          | CodeQL SAST — the analysis the `code-scanning` gate reads                                                        |
| `sonarcloud.yml`        | push to `main`/`feature/**`/`fix/**`/`integration/**`, PR, manual                                                  | Coverage and SonarCloud quality gate                                                                             |
| `dependency-review.yml` | PR                                                                                                                 | Dependency changes reviewed against known advisories                                                             |
| `build-marketplace.yml` | PR, manual                                                                                                         | Maven build of the marketplace package (3 jobs); publishes to preprod only on request                            |
| `release.yml`           | manual                                                                                                             | Release                                                                                                          |
| `changelog.yml`         | push, manual                                                                                                       | Changelog generation                                                                                             |
| `crowdin-push.yaml`     | push to `main` touching an English catalogue or context file, manual                                               | Uploads sources and translator context to Crowdin                                                                |
| `crowdin-pull.yaml`     | daily 00:00 UTC, manual                                                                                            | Downloads translations and opens a pull request                                                                  |
| `crowdin-status.yaml`   | manual                                                                                                             | Reports the Crowdin project state                                                                                |
| `dead-code.yml`         | weekly, Mon 06:00 UTC                                                                                              | Dead-code sweep                                                                                                  |
| `staleness-check.yml`   | scheduled, manual                                                                                                  | Flags `AGENTS/01-services.md` drifting from the service inventory                                                |
| `stale.yml`             | scheduled, manual                                                                                                  | Stale issues/PRs                                                                                                 |
| `pr-auto-fix.yml`       | PR review, issue comment                                                                                           | Applies review feedback                                                                                          |

`staleness-check.yml` is the interesting one: it is a **documentation** gate — an automated
check that a knowledge-base file still matches the code it describes.

---

## 9. Independent adversarial review

Mandatory before a phase is signed off. **Every phase so far self-reported green and
CI-green, and every one contained at least one overstated or self-confirming claim.** Phase
1's would have shipped a dead feature to every customer.

Two review agents are defined as Claude Code subagents:

| Agent                                                                  | Role                                                                                                                                                                  | Constraint                                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`evidence-auditor`](../../.claude/agents/evidence-auditor.md)         | Audits evidence adversarially: is every assertion capable of failing, does it assert the deliverable or the app's pulse, are screenshots and suppressions hiding gaps | **MUST NOT** be used on evidence the caller wrote themselves |
| [`acceptance-validator`](../../.claude/agents/acceptance-validator.md) | Validates the phase delivered what the plan said, and that the written record matches the code                                                                        | Runs after the evidence auditor                              |

Both are specified in [`AGENTS/12-review-agents.md`](../../AGENTS/12-review-agents.md) — that
file is the specification and wins if the agent definitions disagree with it. Both are
`tools: Bash, Read, Grep, Glob` — deliberately read-only. They do not implement or fix.

Guidance that survived contact: **verify every claim first-hand before acting on it.**
Reviewers report false positives. Of the findings from the post-Phase-5 review, two did not
reproduce and were recorded as not reproducing rather than quietly dropped.
