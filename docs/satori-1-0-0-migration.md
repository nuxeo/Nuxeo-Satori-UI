# Satori `1.0.0-alpha.201` → `1.0.0` — migration plan

**Status (2026-11-20):** bumped on `fix/satori-design-system-1-0-0-ebf667`, in review as
nuxeo/Nuxeo-Satori-UI#602, not yet merged. The Outcome section below is the record of what was
done. Everything after it — blockers, impact table, steps — is the plan as written before the
bump, kept for its reasoning; each part says how it turned out.

## Outcome

- `satori-ui`, `satori-lint`, `satori-design-system-checker` and `satori-migrations` are pinned
  to exactly `1.0.0`. `update-satori` rewrote them to `~1.0.0`; the exact pins were put back,
  matching every earlier Satori pin in this repo.
- Lockfile: `npm install` on Node 24, then a diff against the pre-bump lock in three parts.
  - **Dependency changes** (entries added or removed, or with a new `version`): all under a
    Satori package, plus one new transitive dependency (`@isaacs/nonrecursive-glob-match`) and
    `satori-illustrations` 0.5.0 → 0.6.1.
  - **npm metadata outside Satori:** 83 entries changed only their `peer` flag (81 cleared,
    including `@angular/*`, `rxjs` and `typescript`; 2 set, `@types/hammerjs` and `csstype`). Their
    `version`, `resolved` and `integrity` are unchanged. The flag only affects
    `npm install --omit=peer`, which nothing in this repository runs. Why npm recomputed it was
    not established. The first version of this record compared versions only and missed these.
  - **Order:** `@emnapi/runtime`, restored by hand at the end of the lock in `1a9bd4572`, moved to
    its sorted position. Its content is unchanged and no `@emnapi/*` entry was pruned.
  - The `lockfile` and `lockfile-selftest` gates pass.
- `update-satori --from=1.0.0-alpha.201 --to=1.0.0`: 16 of 18 migrators found nothing.
  `migrate-satori-ui-submodule-imports` reported an update to
  `document-detail-slots.spec.ts`, but the only change was Prettier reflowing one line; the file
  already imported from `satori-ui/providers`, so it was reverted. `migrate-satori-icons-to-assets`
  warned about `document-detail` and `satori-components-satori` having no build target. Every
  location it flagged is a spec, a story or the Storybook preview; the Satori Storybook already
  serves the sprite, so nothing changed.
- **One regression the schematics did not catch — fixed.** 1.0.0 dropped the bare-named catalogues
  from `satori-ui/i18n` (`en.json`, `fr.json`, …) and ships only regional files (`en-US.json`, …)
  plus `languages.json`, the DS-2803 locale manifest. The application's languages are bare
  codes, so `AppTranslateLoader` would have requested no Satori catalogue in any language. Every
  `sat.*` string would have been lost, including the platform-nav toggle's accessible name. The
  `guardrails` gate (`checkUpstreamCatalogueLanguages`) caught it. Fix:
  - `UPSTREAM_FOLDERS` lists the eight regional files 1.0.0 ships, and a new `aliases` map sends
    each bare code to its regional file (`en` → `en-US`, `de` → `de-DE`, …). In alpha.171 each
    bare file held the same strings as that region (`en.json` = `en-US.json`, all 54 keys;
    `en-AU` differs in two).
  - `review-guardrails.mjs` no longer counts `languages.json` as a catalogue (it is matched by
    exact name only). Two selftest controls cover it: the manifest beside catalogues stays green,
    and a loader that lists `languages` as a language still goes red.
  - `app-translate-loader.spec.ts` asserts `fr` → `fr-FR.json`, `en` → `en-US.json` (not `en-AU`),
    and that every alias points at a listed catalogue. Seen red on purpose: an `en` → `en-AU`
    alias and a dangling `de` → `de` alias each failed their test.
  - `shared-strings-at-startup.spec.ts` mocked the alpha folder (`en.json`, `fr.json`). Against
    that mock the unfixed loader would have passed while broken in the real app. The mock now
    serves only the 1.0.0 file names and 404s the bare ones. With `aliases` removed, the
    rendered-label tests fail (English and French lose the platform-nav accessible name), 9 of
    the 30 i18n specs in all.
  - The `bundle` gate's required file and the Phase 6 a11y step both checked
    `assets/satori-ui/i18n/en.json`. They now check `en-US.json`, the file the loader fetches for
    English. The bundle gate had gone red on the missing `en.json` before this change.
- **Real-app check** (`nx serve nuxeo-ui` against local Nuxeo, 2026-11-20):
  - `en` requests `assets/satori-ui/i18n/en-US.json` (200); the nav reads "Expand navigation" /
    "Collapse navigation".
  - `fr` requests `fr-FR.json` (200); the nav reads "Développer la navigation".
  - `ja` makes no Satori request and falls back to English, the same behaviour as before the bump.
  - No raw `sat.*` keys and no buttons without an accessible name. All 10 shell icons rendered.
    The served sprite holds 493 icons.
  - The only failed requests are `agentic-ui-config/bootstrap.json` and `manifest.json`, which
    are absent on a plain dev server.
  - Second pass, same day, at 1440×900: Browse (`sat-breadcrumbs`), Contracts (`sat-banner`),
    Trash (`sat-header-bar`), Tasks, Favorites and Search, plus a document's detail page
    (`sat-navigation-tabs`, `sat-breadcrumbs`). Clicking through the first five tabs moves the
    active tab each time. On every page: no blank icon, no raw `sat.`/`nxs.` key, no visible
    control without an accessible name.
  - **RTL (`ar`):** `dir="rtl"`; the platform nav moves from the left edge to the right and the
    main content to the left (screenshot checked). Strings fall back to English because neither
    the app nor satori-ui ships Arabic, so `i18n/ar.json` 404s (the app's own catalogue, an
    existing fallback) and no satori-ui file is requested.
  - **NXQL search page `sat-accordion` — checked 2026-11-20, signed in as the local administrator.**
    The "Filters" header is a `role="button"` with `aria-expanded` and `aria-controls`; the region
    is `role="region"`, labelled "Filters". Click, Enter and Space each toggle it. Collapsed, the
    region is 0px, `visibility: hidden` and `inert`; expanded, it is 55px, visible and not inert.
    Both states were confirmed by screenshot, and the console stayed free of warnings and errors.
    (Measuring while the 225ms transition is still running reads the old state: let it finish.)
  - **Breadcrumbs at the admin's deepest trails (depth 4), no resize between navigations:** at
    1440px every trail is on one line and fits; at 640px, `perm-fixture`'s trail collapses two
    crumbs behind "show more" and fits, and going back restores the shorter trail in full. No
    `NG0956`. Not covered: the parity check `crumb.truncation`'s single over-long crumb (ellipsis
    plus full title). No existing title is long enough, and the parity run needs its own seeded
    Nuxeo (`nxsat-308-parity/start-parity-nuxeo.sh`).
  - **Breadcrumbs `NG0956` (support log, DS-2662) — found and removed, 2026-11-20.** Moving
    between folders logged one dev-mode `NG0956` warning per new trail ("track by identity caused
    re-creation of the entire collection of size 1"). The stack trace pointed at our wrapper,
    `NxsSatoriBreadcrumbsComponent`, not at `sat-breadcrumbs`: its template remounted
    `sat-breadcrumbs` per trail (`@for (trail of [satoriItems()]; track trail)`), added in
    `ca722912d` (NXSAT-308, 13 Oct) because Satori then fitted a trail only at start-up and on
    resize. satori-ui 1.0.0 re-fits whenever `items` changes (an `effect()` in `breadcrumbs.ts` at
    `v1.0.0`), so the wrapper now renders one `<sat-breadcrumbs [items]="satoriItems()" />`.
    - **Test:** the old spec asserted only that a new instance was created. It is replaced by one
      that gives the box a layout (200px; 100px per shown crumb), switches from a 2-crumb to a
      5-crumb trail with no resize, and asserts it collapses to fit with "show more". Seen red
      on purpose: with the `debounceTruncation()` call removed from Satori's items `effect()` in
      `node_modules` (the pre-1.0 behaviour), it failed with `expected 500 to be ≤ 200` — the
      NXSAT-308 overflow. Restored, it passes.
    - **Real app, no resize events:** at 520px, 4 → 5 crumbs collapsed `default-domain` behind
      "show more" and fitted; back to 4 restored it, twice. At 1440px every trail rendered in full.
      `NG0956` warnings: 5 before the change, 0 after, over the same navigation.
- **The Satori Storybook had the same regression — fixed.** `.storybook/preview.ts` and
  `primitives.satori.stories.ts` configured Satori's own loader with `en`, which requested
  `i18n/@hylandsoftware/satori-ui/en.json` (404). Stories showed raw keys
  (`sat.empty-state.server-error.description`, `sat.rich-tooltip.press-escape-to-close`). Both now
  use `en-US`. Satori's loader asks for the exact code and falls back to the base language, so
  the app catalogue path still loads `/i18n/en.json` after one expected `/i18n/en-US.json` 404.
  Checked in the built Storybook: no raw keys, 13 Satori elements, 10 SVG icons, none blank. The
  `satori-components` Storybook builds (446 entries) and does not use Satori's providers.
- **That Storybook regression is now a guardrail.** No gate rendered the Satori Storybook, and a
  build succeeds with raw keys on screen. `checkStorybookSatoriCatalogues` (in `guardrails`)
  reads each Storybook's `staticDirs` and every `fallbackLang` / `TranslateService.use()` value in
  its config and stories, and fails when Satori's loader would find no file for a language (exact
  code, then base language, as the loader does). With the old `en` values put back, it failed on
  all three places, including the stories decorator first missed by hand. The 8 selftest controls
  were checked by weakening the guardrail two ways — no stories-file scan, no base-language
  fallback — and each was caught. Review on #602 then found twelve more ways of writing a
  configuration it could not follow; each was fixed with a control, and it now refuses what it
  cannot read.
- **The authority is now the built Storybook: the `storybook-satori` gate.** It builds
  `satori-components-satori`'s Storybook and runs `scripts/storybook-interactions.mjs --satori`,
  which opens every story in Chromium. A story fails when a request under
  `i18n/@hylandsoftware/satori-ui/` answers an error without the loader's base-language fallback
  loading, when no Satori catalogue loads, or when a `sat.*` key is on screen. No way of writing
  the configuration can make it disagree with what is served. Seen red twice on the real build:
  with the old `en` values (`…/satori-ui/en.json answered 404`, both stories), and with
  `staticDirs` mounted elsewhere (`en-US.json` and its `en.json` fallback both 404). Green on the
  current configuration. It needs the GitHub Packages token and Playwright, so it reports NOT RUN
  without them. Not in PR CI (the PR Storybook job removes `@hylandsoftware` to prove the
  token-free build); it runs in `storybook-pages.yml` on every push to `main`, as a separate
  `storybook-satori` job that does not gate deployment.
- **A stale engineering doc, corrected:** `documentation/30-engineering/07-extensibility-contract.md`
  said satori-ui ships fifteen catalogues, bare names included. It now gives 1.0.0's eight
  regional files and the `aliases` mapping.
- **The icon sprite is now a gate requirement, and it has been seen to fail.** No gate checked
  `satori-icons/satori-icons.svg`, which 1.0.0 downloads at startup (DS-2829); a broken
  `angular.json` glob would have shipped blank icons with every gate green. The `bundle` gate now
  requires the sprite in the build and that it contains `id="menu"`, the header's nav trigger.
  With the glob's `output` pointed at another folder it failed (`satori-icons/satori-icons.svg:
absent`). Restored, it passes.
- **Customer manifests:** the 24 icon names 1.0.0 removed are now listed in
  `docs/extension-reference.md`. Descriptor `icon` values reach `[svgIcon]` at run time, which
  the icon migrator cannot rewrite, so a stale name renders blank with no error.
- **Evidence-harness run: not done.** `npm run beta:evidence` needs `NUXEO_USER`/`NUXEO_PASS`,
  which this session did not have. The checks above were made in the preview browser, and their
  results are recorded here instead of under `~/Desktop/agentic-ui-evidence/`.
- **Adoption score: 99.69 → 89.61, caused by the checker, not by our code.** The alpha.171
  checker scores the same tree 99.61. Checker 1.0.0 counts CIC Nav use in the design-language
  KPI, and we do not use CIC Nav. Details and the excusal route are in
  `docs/satori-adoption-dashboard.md`.
- **Gates:** all 40 local gates pass. `code-scanning` runs on the PR. (The Satori 1.0.0 release
  announcement is dated 17 Nov 2026.)

This plan covers what the 1.0.0 release changes, what each change means for this repo, and the
order of work. Every "impact" row below comes from a search of this branch, not from the release
notes alone. Where a row says **verify**, the search could not settle it without the 1.0.0
packages installed.

Sources: the 1.0.0 release announcement (summary, breaking-change list, changelog), the
`satori-migrations` collection and READMEs (read from the `1.0.0-alpha.171` copy in the main
checkout's `node_modules`; the worktree has no install), and the
[1.0.0 migration guide in Storybook](https://storybook.supernova.io/design-systems/375663/alias/storybook/index.html?path=/docs/misc-migration-1-0-0--overview).

## Where we start

| Package                                        | Today (`package.json`) | Target                        |
| ---------------------------------------------- | ---------------------- | ----------------------------- |
| `@hylandsoftware/satori-ui`                    | `1.0.0-alpha.201`      | `1.0.0`                       |
| `@hylandsoftware/satori-lint`                  | `1.0.0-alpha.201`      | `1.0.0` (lockstep)            |
| `@hylandsoftware/satori-design-system-checker` | `1.0.0-alpha.201`      | `1.0.0` (lockstep)            |
| `@hylandsoftware/satori-migrations`            | `1.0.0-alpha.201`      | `1.0.0` (lockstep)            |
| `@hylandsoftware/satori-icons`                 | `^4.0.0`               | `^4.0.0` (unchanged)          |
| `@ngx-translate/core`                          | `18.0.0`               | `^18` (already met — DS-2197) |
| Angular                                        | `~22.2.x`              | `>=22 <23` (met)              |

`satori-icons`, `satori-illustrations`, `satori-tokens` and `satori-fonts` are **not** on the
lockstep train (`update-satori/registry.js`), so `update-satori` will not bump them. Bump them by
hand to the version `satori-ui@1.0.0` peers.

The last two upgrades show what this kind of work involves: `76326b339` (alpha.175) and `1a9bd4572`
(alpha.201). In alpha.201 the icon sprite became a startup asset, `@emnapi/runtime` had to be
restored in the lockfile, and the Material expansion panel was replaced with `sat-accordion`.

## Blockers — resolved 2026-11-19 from the `v1.0.0` tag of `HylandSoftware/satori`

1. **Registry — stays on GitHub Packages.** Satori's `publish-stable.yml` publishes every stable
   release to both Cloudsmith (`npm.artifacts.hyland.dev/cic-unified-shared-libs/`) and
   `npm.pkg.github.com`. The `v1.0.0` GitHub release (17 Nov) is created by that same workflow
   after the publish job. Our `.npmrc` does not need to change, so DS-2770 does not affect us.
2. **Peer ranges — all met.** `packages/satori-ui/package.json` at `v1.0.0` peers
   `@angular/* >=22.0.0 <23.0.0`, `@ngx-translate/core ^18.0.0`, `rxjs ^7.8.0`, `sass ^1.85.0`. It
   depends on `satori-icons ^4.0.0`, `satori-tokens ^0.6.0`, `satori-fonts ^3.0.0` and
   `satori-illustrations ^0.6.1`, so the companion packages need no bump either.
3. **Migrator list — 18 tagged `1.0.0`.** That is the 17 listed below plus
   `migrate-satori-icons-to-assets` (DS-2829). 1.0.0 stops bundling icons into the JavaScript and
   downloads `satori-icons/satori-icons.svg` at startup. `angular.json` already serves that asset
   (added in `1a9bd4572`), so the migrator should make no change. `SatoriConfig.icons` is now an
   object, but we call `provideSatori()` with no arguments.
4. **NgModules — still exported.** `SatPlatformNavModule`, `SatAppHeaderModule`,
   `SatAvatarModule`, `SatLogoModule` and `SatTagModule` are all in their `public-api.ts` at
   `v1.0.0`.

**Install — resolved 2026-11-19.** This was the last open blocker: the
`SATORI_GH_READONLY_TOKEN` in use had expired (GitHub answered 401 on `/user`). Once it was
replaced with a token holding `read:packages`, the four packages resolved to `1.0.0` from GitHub
Packages, and the lockfile was regenerated as described in Outcome. Nothing in this section
remains to do.

## Breaking changes → impact here

Key: **none** = the search found nothing to change; **verify** = check after install;
**manual** = a code change the schematics will not make.

After the install, every **verify** row was settled. The two still marked **verify** below,
DS-1108 and DS-885, were confirmed by their own migrators in the `update-satori` run ("No
deprecated override calls found", "No deprecated language config 'default' usage found"). The
only **manual** change needed was DS-2803, which is described in Outcome.

| Change                                                                                                                             | Migrator                                                     | Impact here                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DS-2402 remove `satori-preview`                                                                                                    | `migrate-preview-to-satori-ui`                               | **none** — no `satori-preview` import, asset or dependency                                                                                                                                                                                                                                                                                           |
| DS-2395/2681/2390/2399/2394/2392/2387/2385/2393/2389/2397 — components moved into `satori-ui`                                      | `migrate-preview-to-satori-ui`                               | **none** — we already import `satori-ui/platform-nav`, `header-bar`, `upload-field`, `navigation-tabs`, `banner`, `action-bar`, `interactive-card`, `empty-state`, `ghost`                                                                                                                                                                           |
| DS-2371 remove `satori-cic` re-exports; DS-2769 CIC Nav environment ID mandatory                                                   | —                                                            | **none** — `satori-cic` / CIC Nav not used                                                                                                                                                                                                                                                                                                           |
| DS-2405 remove deprecated barrel re-exports                                                                                        | `migrate-satori-ui-submodule-imports`                        | **none** — every import is a submodule path; no bare `@hylandsoftware/satori-ui` import                                                                                                                                                                                                                                                              |
| DS-2107 non-prefixed export names                                                                                                  | `migrate-non-standardized-export-names`                      | **none expected** — we already use `provideAndConfigureSatoriTranslations`; no `RichTooltip*` unprefixed types found                                                                                                                                                                                                                                 |
| DS-1850 suffixed class names (`Sat*Component`)                                                                                     | `migrate-suffixed-class-names`                               | **none** — no `Sat*Component`/`Sat*Directive` imports                                                                                                                                                                                                                                                                                                |
| NgModules still in use: `SatPlatformNavModule` (29 refs), `SatAppHeaderModule`, `SatAvatarModule`, `SatLogoModule`, `SatTagModule` | `migrate-deprecated-ngmodules` (exists; release tag unknown) | **none** — still exported at `v1.0.0` (see blockers)                                                                                                                                                                                                                                                                                                 |
| DS-1505 deprecated icon names (`AI`, `Nuxeo`, `regenerate_ai`, `record_audio`, …)                                                  | `migrate-deprecated-satori-icons`                            | **none static**. The migrator skips dynamic `[svgIcon]="expr"`, so manifest- and map-driven icon names (`docTypeIcon`, Layer 0/1 manifests, extension descriptors) need a manual check. No capitalised icon names were found in `.ts`/`.json`, but customer manifests can supply any name: **document** the renames in `docs/extension-reference.md` |
| DS-1353 remove `SatIconModule`                                                                                                     | `remove-icons-module`                                        | **none** — `provideSatori()` already in `app.config.ts`                                                                                                                                                                                                                                                                                              |
| DS-2829 smaller initial icon bundle                                                                                                | `migrate-satori-icons-to-assets`                             | **none expected** — the sprite asset already sits in both `angular.json` configurations and in `satori-components-satori/.storybook/main.ts`. Icons still need a real browser check: a missing sprite renders blank, with no error.                                                                                                                  |
| DS-2366 rename Avatar statuses                                                                                                     | `migrate-avatar-indicator-status`                            | **none** — no `status` binding on `sat-avatar`                                                                                                                                                                                                                                                                                                       |
| DS-822 platform-nav avatar content projection removed                                                                              | `migrate-avatar-projection`                                  | **none for nav items** (already `<sat-platform-nav-avatar [item]>`). **Verify** the user profile button in `app-shell.component.html:36-41`, which projects a `<sat-avatar>`. The migrator handles only initials, a lone `img` or a lone `mat-icon`.                                                                                                 |
| DS-821 legacy App Header selectors                                                                                                 | `migrate-app-header-selectors`                               | **none** — `sat-app-header` already                                                                                                                                                                                                                                                                                                                  |
| DS-915 Rich Tooltip inputs removed, `(close)` → `(closed)`                                                                         | `migrate-rich-tooltip-inputs`                                | **none** — wrapper template uses none of them                                                                                                                                                                                                                                                                                                        |
| DS-1638 Banner `orientation`; DS-1648 Upload Field `<svg>`; DS-1480 `satHideIcon`                                                  | respective migrators                                         | **none** found                                                                                                                                                                                                                                                                                                                                       |
| DS-1108 styling overrides removed                                                                                                  | `migrate-deprecated-override-tokens`                         | **verify** — search SCSS for `sat-avatar-overrides`, `sat-breadcrumbs-overrides`, `sat-app-header-overrides`                                                                                                                                                                                                                                         |
| DS-885 language config `default` → `fallbackLang`                                                                                  | `migrate-language-config-default`                            | **verify** — config in `provide-nxs-satori-components.ts`                                                                                                                                                                                                                                                                                            |
| DS-2803 supported languages manifest                                                                                               | —                                                            | **manual — done** — 1.0.0 dropped the bare-named catalogues; see Outcome. Reading `languages.json` at runtime instead of declaring the list is a possible follow-up, not needed for the bump.                                                                                                                                                        |
| DS-2197 ngx-translate 18                                                                                                           | companion bump                                               | **done** (`18.0.0`)                                                                                                                                                                                                                                                                                                                                  |
| DS-2373 `sdsp` removed                                                                                                             | —                                                            | **none** — scripts use `sdsc`                                                                                                                                                                                                                                                                                                                        |
| satori-lint rules scoped to `**/*.html`                                                                                            | `migrate-satori-lint-eslint-config`                          | **none** — `eslint.config.mjs` already scopes to `**/*.html`                                                                                                                                                                                                                                                                                         |

Figma-only changes (Card slots, Expansion Panel and Toolbar removed, Chip variants pruned) need no
code changes. Design files that still use those components need a separate design pass.

## Steps

The plan as written before the bump. How each step turned out, as of 2026-11-20:

| Step                         | Status                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Unblock                    | Done — see Blockers                                                                                                                                                                                                                                                                                                                                      |
| 2 Branch + bump              | Done — see Outcome. No companion-package bump was needed                                                                                                                                                                                                                                                                                                 |
| 3 Schematics                 | Done — dry run, then real run; one formatting-only change reverted                                                                                                                                                                                                                                                                                       |
| 4 Manual fixes               | Done — the translation-catalogue mapping (DS-2803) was the only one                                                                                                                                                                                                                                                                                      |
| 5 Gate                       | Done locally — 40 of 41 gates pass; `code-scanning` runs on the PR                                                                                                                                                                                                                                                                                       |
| 6 Real-app check             | **Done** — shell, nav, icons, Browse, Contracts, Trash, Tasks, Favorites, Search, document detail and tabs, three languages and RTL (`ar`), both Storybooks, and (as admin) the NXQL accordion. Not covered: the parity `crumb.truncation` single over-long crumb, which needs the dedicated parity Nuxeo. Recorded here rather than as harness evidence |
| 7 Prove the icon check fails | **Done** — the `bundle` gate now requires the sprite; it failed with the glob broken and passed restored                                                                                                                                                                                                                                                 |
| 8 Docs                       | **Done** — versions, score, and the removed icon names in `docs/extension-reference.md`                                                                                                                                                                                                                                                                  |
| 9 Adversarial review         | **Open**                                                                                                                                                                                                                                                                                                                                                 |

1. **Unblock** — resolve the three blockers above. Record the registry decision in
   `docs/adf-hx-beta-plan.md` if it changes.
2. **Branch + bump** — set the four lockstep packages to `1.0.0` and bump `satori-icons` (and
   `satori-tokens`/`fonts`/`illustrations` if `satori-ui@1.0.0` peers new majors). Regenerate the
   lock **without a bare `npm install` commit**: start from the known-good lock, merge in the new
   entries, and restore the macOS-pruned optional entries (`@emnapi/runtime` last time). Then run
   `npm run beta:gate -- --gates lockfile`.
3. **Run the schematics — dry run first:**
   `npx nx g @hylandsoftware/satori-migrations:update-satori --from=1.0.0-alpha.201 --to=1.0.0 --dry-run`.
   Expect almost no file changes. Review every changed file, because
   `migrate-non-standardized-export-names` does a word-boundary rewrite across the whole file,
   including comments and strings.
4. **Manual fixes** — every **verify** or **manual** row above: NgModules, the icon sprite path,
   the profile-button avatar, SCSS overrides, language config, the i18n asset glob.
5. **Gate** — `npm run beta:gate` (all gates). `test` does not typecheck, so `build` and
   `typecheck` are the ones that catch a removed export.
6. **Real-app check** — `nx serve nuxeo-ui` against local Nuxeo, then check: the platform nav
   (expand/collapse, avatars, clipboard badge), the header bar and mobile trigger, a sample of
   icons (static and manifest-driven), the banner, empty and error states, upload, breadcrumbs,
   the rich tooltip, tabs, the NXQL accordion, an RTL language and a non-English catalogue. Run
   both Storybooks. Capture evidence under `~/Desktop/agentic-ui-evidence/` with real reloads.
7. **Prove the icon check can fail** — point the sprite glob at a wrong path, watch the icon
   assertion go red, then restore it (CLAUDE.md: a gate is not evidence until it has failed on
   purpose).
8. **Docs** — update the versions in `docs/satori-adoption-dashboard.md` and the deprecated-icon
   renames in `docs/extension-reference.md`. Re-run `npm run satori:score`.
9. **Independent adversarial review** before merge.

Estimate: 1–2 days if 1.0.0 is on GitHub Packages and the NgModules survived; add time for the
registry migration if it is Cloudsmith-only.

## Adoption opportunities (separate tickets, not part of the bump)

- **AI Disclosure tag** (DS-2854) — mark AI-generated content (AI chat answers, enrichment,
  summaries). Probably the most valuable new component for this product.
- **Important button** (DS-2382) — destructive actions: delete, permanent trash purge, remove
  permission. Expose it as a variant on the `nxs-` wrapper, not as a direct `sat-` use.
- **Tonal button / icon button** (DS-2731) — secondary emphasis in toolbars.
- **Breadcrumb Title variant** (DS-1508) — the folder header and document detail title.
- **Drag & drop** on list, card, dialog and table rows (DS-2359) — possible replacement for the
  custom drag handling in the document list and dropzone.
- **Accordion** — already adopted on the NXQL page; candidates elsewhere wherever
  `mat-expansion-panel` remains.

Each new component goes through the `nxs-` wrapper. If it is customer-facing, it also goes through
Layer 0/1 (`add-extension-point` skill).
