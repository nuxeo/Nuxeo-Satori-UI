# Angular 20 → 21 (NXSAT-669)

What moved, what Angular 21 and Vitest 4 changed underneath us, and the decision taken for each.
Every decision preserves Angular 20 behaviour unless it says otherwise; adopting the new defaults
(zoneless change detection in particular) is separate work, done one surface at a time with tests.

Sources: the 21.0.0 sections of the Angular and Angular Components changelogs, the Vitest 4
migration guide, and the migration manifests shipped in `@angular/core@21.2.25` and
`@schematics/angular@21.2.27`.

## Versions

| Package                                           | Angular 20 state | Angular 21 state |
| ------------------------------------------------- | ---------------- | ---------------- |
| `@angular/*` framework                            | 20.3.34          | 21.2.25          |
| `@angular/cli`, `build`, `devkit`                 | 20.3.33          | 21.2.27          |
| `@angular/material`, `cdk`, date adapter          | 20.2.14          | 21.2.14          |
| TypeScript                                        | 5.8.3            | 5.9.3            |
| Vite (workspace and both Angular builders)        | 6.4.3            | 7.3.7            |
| Vitest, `@vitest/coverage-v8`, `@vitest/ui`       | 3.2.7            | 4.1.10 (exact)   |
| `ng-packagr`                                      | 20.3.2           | 21.2.7           |
| `angular-eslint`                                  | 20.7.0           | 21.4.0           |
| `@analogjs/vite-plugin-angular`, `vitest-angular` | 1.22.5           | 2.9.0            |
| Storybook                                         | 9.1.20           | 10.6.3           |
| `@hylandsoftware/satori-ui`                       | 0.2.1            | 0.3.3            |

`zone.js` (0.15.1), `nx` (22.7.8), `esbuild` (0.28.1) and `jsdom` (28.1.0) are unchanged. Node
stays on 20, with `engines` tightened from `20.x` to `^20.19.0` — the minimum the Angular 21 CLI,
`@angular/build` and Vite 7 declare. The gate compares only the major, so Node 20.0–20.18 passes it
and then `ng` refuses to run; `engines` is what records the real floor.

Vitest is pinned to **4.1.10 exactly**, not a range: Storybook 10's optional `vite-plus` peer
reaches `@vitest/browser-playwright@4.1.10`, which wants that exact Vitest.

`@mat-datetimepicker/core` was removed with its allowlist entry — nothing imported it and it has no
Angular 21 release. The other ADF-era pins are NXSAT-672's.

## Behaviour changes, and what was done

### Zoneless change detection is the default

Angular 21 bootstraps zoneless unless the application provides zone change detection, and
**TestBed's root providers changed with it**: Angular 20's `testing.mjs` installs
`internalProvideZoneChangeDetection({})`, 21.2.25 installs `provideZonelessChangeDetectionInternal()`.

Two consumers, and they needed different fixes.

- **Both applications.** The `bootstrap-options` migration put `provideZoneChangeDetection()` in
  `main.ts`, so `nuxeo-ui` and `nuxeo-satori-template` keep zone.js change detection.
- **The 21 Vitest libraries.** Each library's `src/test-setup.ts` calls `initTestEnvironment` by
  hand, with no zone provider, so a spec that does not choose a mode switched from zone to zoneless
  silently. Angular's own runners do not leave it to chance — the Karma builder and the Vitest
  runner both add `provideZoneChangeDetection()` to the TestBed environment when `zone.js` is in
  `polyfills` (`@angular/build/src/builders/karma/application_builder.js`,
  `.../unit-test/runners/vitest/build-options.js`). Each setup file now declares the same thing: an
  `NgModule` providing `provideZoneChangeDetection()`, passed to `initTestEnvironment` beside
  `BrowserDynamicTestingModule`. The extension-library generator's template does too, so a
  customer's library starts in the same state.

  This is the one `NgModule` in the repository, and `src/test-setup.ts` is exempted from the
  `satori-components` federation-readiness guardrail for it — `tsconfig.lib.json` excludes the file
  from the library build, so nothing crosses a federation boundary. The exemption is exactly that
  path: an `NgModule` in any other `test-setup.ts` still fails, with a control for both.

  136 spec files opt into `provideZonelessChangeDetection()` explicitly, on Angular 20 and 21
  alike, and keep it. They are the source of the NG0914 "zoneless but still loading Zone.js"
  warnings — 3,381 on Angular 20, 3,383 on 21 — which predate this branch.

`apps/nuxeo-ui`'s Karma suite was never affected: its builder already added the provider. Moving
`provideZoneChangeDetection()` from `main.ts` into `appConfig` was tried, measured and reverted —
it changed no spec's mode and no result.

### `Router.getCurrentNavigation()` → `currentNavigation()`

The `router-current-navigation` migration renamed both call sites. Both are read inside a
`paramMap` subscribe in `ngOnInit`, which is not a reactive context, so the new signal's tracked
read has no effect. The two reads — `freshNote` and `freshBlobDocument` from `extras.state` — are
covered by tests added for the rename, each seen failing with the in-flight read removed.

### Unused `CommonModule` imports

The `control-flow` migration dropped them from four components. The templates use only `translate`
and built-in control flow, so there was nothing to replace.

### Migrations deliberately not kept

- **`use-application-builder`** removed `@angular-devkit/build-angular`, which Karma and Storybook
  still need.
- **`moduleResolution` / `esModuleInterop` in `tsconfig.json`** — `module: preserve` already
  implies both.
- The **Material and CDK v21 migrations** changed nothing.

## Vitest 4

### The v8 provider counts statements through the AST

Vitest 3 credited a whole line; Vitest 4 maps coverage through the syntax tree, so a function body
or a `return` sharing a line with code that ran is now its own uncovered statement. Thirteen
projects read lower for that reason alone and the ratchet failed. See [Coverage](#coverage).

### A file no spec imports is dropped from the report

Vitest 3 listed it at 0%; Vitest 4 omits it. An omitted file leaves the denominator, so untested
code becomes invisible rather than failing — the inverse of what a coverage gate is for, and it
inflated `@nuxeo-satori/generators` from 20.89% to 95.69%.

Fixed where it arose, by naming the sources instead of allowlisting them:
`coverage.include: ['src/**/*.ts']` in `tools/satori-generators/vitest.config.mts`, and
`['src/**/*.ts', 'vitest.setup.ts']` with `exclude: ['src/**/*.spec.ts']` in
`libs/integration-tests/vitest.unit.config.mts`. Four `index.ts` barrels that genuinely have no
executable statement went to the allowlist's permanent `noStatements` half.

### `vitest.workspace.ts` is ignored, and must not become a root `vitest.config.ts`

Vitest 4 dropped workspace files in favour of a `projects` list in the root config, so
`vitest.workspace.ts` was dead weight and is **deleted with nothing in its place**. Nothing ran
Vitest from the workspace root: every invocation names a config (`--config …/vitest.config.mts`)
or goes through an Nx per-project `test` target.

Porting it to a root `vitest.config.ts` is the obvious move and it is wrong. `@nx/vitest` infers a
project from every Vitest config it finds, so a config at the root makes the **workspace root an Nx
project** — `agentic-ui`, with no `tags`. `tools/i18n/test-translate-setup.ts` then belongs to that
untagged project instead of to no project, and every `scope:shared` library importing
`@agentic-ui/testing/i18n` becomes a `@nx/enforce-module-boundaries` error: four in `libs/shared/ui`
alone, in spec files nothing had touched. `nx show projects` is the tell — 34 entries instead of 33.

If a root config is ever needed, give the root project `tags` first, and exclude `dist/**` from the
glob: compiled copies of the project configs under `dist/out-tsc` otherwise claim the same project
names and abort the run.

### Spec adaptations

- A mock called with `new` must be a function, not an arrow — Vitest 4 constructs it (the Quill
  constructor mock).
- `spyOn` returns an existing module-scope mock, so call history carried between tests until they
  cleared mocks in `beforeEach`.

## ng-packagr 21 changed the published type layout

ng-packagr 21 writes one flattened `types/<entry>.d.ts` per entry point and declares it in
`exports[…].types` and each entry's `package.json` `typings`. Three checks — `publishability`,
`upgrade-rehearsal` and the phase-4 evidence step — hardcoded the ng-packagr 20 layout,
`<entry>/index.d.ts`, so the publishability probe resolved nothing and reported TS2307 against a
package that was fine. `entryTypes()` now resolves the way TypeScript does: `exports` types, then
the entry's `typings`, then the old layout.

## Overrides

`piscina` and `undici` began as security floors and had become downgrades: `@angular/build@21.2.27`
and `@angular-devkit/build-angular@21.2.27` declare `piscina: 5.3.2` exactly while the override
forced 5.3.0, and `@angular/build` declares `undici: 7.29.1` while the override forced 7.29.0.
`lockfile-integrity` exempts overridden packages, so no gate noticed.

Both now sit at or above what the toolchain declares: `piscina` 5.3.2, and `undici` **7.30.1** —
above the declared 7.29.1, because 7.30.1 is the first release fixing GHSA-xjj6-f33q-929c (high),
GHSA-4qv8-2p9j-2685 and GHSA-f72v-6w45-q472. An override above a declared range is a floor; one
below it is a downgrade.

## Coverage

The ratchet baseline was re-recorded, and a re-record is indistinguishable from a silent loosening
unless something proves no coverage was lost. Percentages cannot: the unit of measurement changed.

`scripts/coverage-line-diff.mjs` compares two runs' `coverage-final.json` files over source files
identical between the two revisions. Every line covered before and not now is judged **column by
column** on each run's own data, with counters summed across every project that measured the file.
A line is a loss when some column ran before and is unexecuted now. Missing evidence does not count
as evidence: a function the earlier run did not model leaves its statements' credit standing. A
covered file that is absent afterwards makes the result incomplete (exit 3), not clean. Its controls are
`scripts/coverage-line-diff.selftest.mjs`: eleven, six of which plant a loss and require a non-zero
exit, because a tool that reports "REAL LOSS 0" without ever having reported anything else proves
nothing. Five of those six pass against the comparator's first version only by failing, which is how
its review (PR #464) showed that version could not see those losses.

**The comparison that proves it** holds the measurement constant. Vitest 3.2 ships the AST-aware
remapping Vitest 4 made the default (`coverage.experimentalAstAwareRemapping`), so the merge base
`ec82e5574` (Angular 20, Vitest 3) was re-run with it on, against this branch on Vitest 4:

|                                 |       |
| ------------------------------- | ----- |
| unchanged files compared        | 266   |
| lines covered before, not after | **0** |
| lines covered after, not before | 0     |
| covered files absent afterwards | 0     |
| **REAL LOSS**                   | **0** |

The 118 files absent afterwards are all at 0% before: files no spec imports, which Vitest 3 counted
and Vitest 4 omits.

Compared against Vitest 3's default line-based report instead, 99 lines are covered before and not
after. 44 of them are explained by the earlier run's own data. The other 55 sit inside functions
that run did not model, such as callbacks, `catchError` fallbacks, and a dialog no spec constructs.
The comparator reports these as unproven rather than explained, and the like-for-like run above shows
that none of them ran on Angular 20 either: under the same measurement, nothing was lost.

Re-running the two projects after the `coverage.include` fix gives the honest figures —
`@nuxeo-satori/generators` 53.37% over 208 statements (was 95.69% over 116) and `integration-tests`
50.84% over 297 (was 62.92% over 240) — with covered statements unchanged in both and REAL LOSS 0
over the 14 files compared. The gate classes a drop as a non-regression only when covered statements
rise strictly, so these were re-recorded rather than waved through, after that proof.

The baseline now records **18 of 24 projects at ≥90%**, and 11 of 16 in the Beta slice.
`document-detail` (88.03%) and `nuxeo-client` (87.48%) fall below the bar under the new counting and
are the two to raise first. Both hard floors hold: `satori-components` 99.02%, `-satori` 100%.

To reproduce, run the suite on each revision and diff the reports. On the Angular 20 checkout, add
`experimentalAstAwareRemapping: true` beside `provider: 'v8'` in every Vitest config first, and run
with `--skip-nx-cache`, because a cache hit restores the old line-based report:

```bash
node scripts/beta-harness/coverage-gate.mjs --run      # writes coverage/ for all Vitest projects
node scripts/coverage-line-diff.mjs \
  --before <a20-checkout>/coverage --before-root <a20-checkout> --before-rev ec82e5574 \
  --after  ./coverage              --after-root  .             --after-rev  HEAD
```

Exit status: 0 no loss, 1 a loss, 2 a usage error, 3 an incomplete measurement.

## Validation

Run from a dedicated worktree on Node 20, with `NX_WORKSPACE_ROOT_PATH` unset and the Nx cache
isolated — Nx 22 shares one cache across every worktree of a checkout, and an inherited
`NX_WORKSPACE_ROOT_PATH` points it at the primary one. Both produced invalid evidence once.

| Check               | Angular 20 baseline          | Angular 21                                                  |
| ------------------- | ---------------------------- | ----------------------------------------------------------- |
| `beta:gate`         | pass, 32 green               | pass                                                        |
| Karma (`nuxeo-ui`)  | 495 / 495                    | 495 / 495                                                   |
| Vitest, 24 projects | 5,915 passed                 | 5,917 passed                                                |
| Coverage gate       | pass                         | pass                                                        |
| e2e                 | 41 pass, 8 fail (all WebKit) | 43 pass, 3 fail, 3 flake (all WebKit, a subset of the same) |
| Runtime a11y        | 5 pass, 2 fail               | same 2 fail                                                 |
| `format-check`      | fails, 116 files             | fails, 115 files                                            |

`format-check` fails on both: it is red on `main` too, and `dead-code.yml` does not parse there.
The i18n audit's counts depend on the Nuxeo instance's data, so they are not comparable between
runs. The e2e and a11y failures are pre-existing and reproduce on the baseline.
