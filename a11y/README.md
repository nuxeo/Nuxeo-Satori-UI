# Runtime accessibility scanning

Playwright driving the real application through **a11y-scout**, which does what no static rule
and no axe run can: presses keys. Tab and Shift+Tab walks looking for traps and focus leaks,
viewport resizes to 320px for reflow geometry, focus-indicator comparison, and — with an LLM
provider configured — content-quality judgement on alt text, link purpose and headings.

This is **development tooling with an expected end date**, and the folder is laid out to be
removed cleanly. See [Removing this](#removing-this).

```bash
npm run a11y:scan -- --help
```

## What is here

```
a11y/
  run.mjs              the only entry point; every suite and diagnostic is a subcommand
  preflight.mjs        refuses to scan a stack that is not there
  playwright.config.ts self-contained; does not extend the critical-path config
  fixtures.ts          the a11y-scout test object, installSession, expectSurfaceUsable,
                       waitForScreenSettled, aiFindingsNote, REPORT_DIR
  cli.mjs              strict argument parsing for every Node script here; an unknown option,
                       a stray value or a missing one exits 2 before anything runs
  cli-args.mjs         what run.mjs decides about an argv before it spawns anything —
                       --project scope, the grep forms, --no-report. Split out so it can be
                       imported and asserted; run.mjs owns the messages and the exit codes
  cli-args.selftest.mjs  controls over that contract — `run.mjs selftest`
  env.mjs              resolveBaseUrl + required Nuxeo credentials — one definition, shared
                       by the config, the preflight and all three diagnostics
  session.mjs          the app session injected into every signed-in page, and the check
                       that the app adopted it rather than falling back to a cookie session
  surface.mjs          the Node-side twin of expectSurfaceUsable, the single list of this
                       application's error-state classes, and the settle wait every scan
                       makes before measuring
  versions.mjs         the one runtime source for the pinned Playwright/axe install versions;
                       every printed install command imports from here instead of repeating them
  package.json         "type": "module", because a11y-scout is ESM-only
  tsconfig.json        allowJs + checkJs, so the .ts side can import those two .mjs modules
  specs/
    journey.screens.ts        single source for screen id -> project name, tag, report name
    surfaces.a11y.spec.ts     pages, default loaded state
    interaction-states.a11y.spec.ts  components and overlays, behind a click
    display-modes.a11y.spec.ts       dark, forced-colors, reduced-motion
    journey.a11y.spec.ts      workflows, one self-contained report per screen
  diagnostics/
    axe-differential.mjs      axe under two rule configurations, diffed
    reflow-probe.mjs          320px overflow measured independently of the scanner, with the
                              nav drawer closed so the screen is measured, not the drawer
    route-render-check.mjs    every scanned route renders its feature host, not an error state
    error-class-drift.mjs     surface.mjs still matches the templates it describes
  docs/
    authoring.md              how to write a new check
    a11y-scout.md             what the tool is and how to install it
  reports/                    gitignored output
  artifacts/                  gitignored traces and videos
```

The suites are grouped by **what the scan looks at** — pages, components, display modes,
workflows — not by WCAG rule, because the reports already group by rule.

## Prerequisites

The a11y-scout tarballs are hand-distributed and resolve from no registry, and Playwright is
kept untracked so CI installs are unaffected by a browser download. Install all of them in
**one command** — `npm install --no-save X` prunes anything previously installed with
`--no-save`, so separate installs remove each other. The Playwright and axe versions are
pinned, not left to resolve to whatever is newest: the recorded findings below were measured
against `@axe-core/playwright@4.13.0`, which `axe-differential.mjs` confirms resolves the same
deduped `axe-core@4.13.0` that `a11y-scout@0.3.0` uses, and an unpinned later install could pull
a different engine or browser build and make a re-scan incomparable to that baseline. These
versions live in exactly one runtime source, `a11y/versions.mjs`; this and every other
install command below is kept in sync with it by hand, since prose cannot `import` it.

Writing a version into an install command only pins it for whoever runs that exact command, and
nothing here is in the lockfile, so `preflight` reads what is actually in `node_modules` and
**refuses to scan** (exit 2) when it does not match. `axe-core` arrives transitively and is
reported rather than enforced — the fix for it is to re-pin the two packages above.

```bash
npm install --no-save @playwright/test@1.63.0 @axe-core/playwright@4.13.0 \
  <path>/a11y-scout-0.3.0.tgz <path>/a11y-scout-playwright-0.3.0.tgz
npx playwright install chromium

npm run beta:backend && npx nx serve nuxeo-ui
```

**`NUXEO_USER` and `NUXEO_PASS` are required, not defaulted.**

```powershell
$env:NUXEO_USER = "<user>"; $env:NUXEO_PASS = "<password>"   # PowerShell
export NUXEO_USER=<user> NUXEO_PASS=<password>               # bash
```

`.cursor/rules/security.mdc` prohibits hardcoded credential fallbacks, and a default is also
worse than an error in practice: against a server that happens to accept `Administrator`, it
scans as the wrong identity and the report never says so. Both the Playwright config and the
Node tooling throw when either is unset, so a run fails at load rather than silently
mis-authenticating.

**The account needs administration access** — an administrator or a `powerusers` member — for
`surfaces`, `modes`, `journey` and the three diagnostics, because all of them visit
`/#/administration` and `adminGuard` redirects anyone else to the dashboard. Only `states`
does not go there and runs with any account. Each command that needs it checks it and exits 2
if not.

`journey` asks one thing more: its administration screen is the analytics page an
**administrator** lands on, which `fullAdministratorGuard` closes to `powerusers` members —
they are redirected to users and groups instead. So `journey` requires an administrator and
exits 2 for a `powerusers` member, rather than reporting the stack ready and failing on its
last screen.

`npm run a11y:scan -- preflight` checks the stack and changes nothing. It **reports** the
account's role but does not enforce one, because it does not know which suite comes next — it
exits 0 for an ordinary account. Each suite command runs it with the role that suite needs and
exits 2 if the account falls short.

Because everything is `--no-save`, **`package-lock.json` is untouched by this folder** — there
is no dependency to unwind when it is removed.

### The LLM provider is optional, and its absence is not neutral

With no LLM provider configured, a11y-scout runs in mock mode. Axe, the keyboard walk and
reflow all still produce real findings, but the AI content-quality checks are **skipped
entirely** — eleven WCAG criteria (1.1.1, 1.3.3, 2.4.2, 2.4.4, 2.5.3, 3.3.1, 3.3.2 at A; 1.3.5,
2.4.6, 3.1.2, 3.3.3 at AA). An empty semantic result means _not measured_, not _clean_. The
preflight prints which provider a11y-scout selected, and whether it is mock, for exactly that
reason — it asks a11y-scout rather than guessing from one variable, because a `HAIP_API_KEY` is
not the only way in: see [docs/a11y-scout.md](docs/a11y-scout.md#llm-configuration-is-optional)
for how Bedrock is selected.

**A key that connects is not yet a key that works.** Measured on 2026-09-22 with a real key:
`a11y-scout doctor` reported `Active: haip, Mode: READY`, every report recorded
`provider: haip`, and the cost meter billed 15 calls — but every content-quality call returned
**403** and all four screens produced `aiGenerated: 0`. The eleven criteria were still
unmeasured, and the only signal was a `LLM call failed … 403` line on stderr; the report header
looked like a successful AI run.

The agents that need a key — `content-quality`, `aaa-semantic`, `fix-html`, `fix-preview` — all
request the **reasoner** model, which defaults to `openai.gpt-oss-120b-1:0`. If a key is not
entitled to that model, point it at one it can reach:

```bash
export HAIP_MODEL_REASONER=<a model the key is allowed>
```

**How to read `aiGenerated: 0` with a live key.** It is _ambiguous_, not proof either way.
`aiGenerated` counts findings, not executions, so a provider that ran and found nothing also
reports zero. The cost meter cannot settle it either: `cost.entries` records completed calls
without saying which scanner made them, and the fix agents use the same model. The deciding
signal is stderr. A `content-quality: LLM call failed` line means the eleven criteria were
**not measured**; its absence, with calls completed, is the only case where zero may mean
clean. (In mock mode zero is simply unmeasured.) Cost is not the constraint: a full
four-screen journey billed **$0.0059** on 2026-09-22.

## Running it

```bash
npm run a11y:scan -- journey      # ~70 min, fifteen screens, one report per screen
npm run a11y:scan -- surfaces     # ~27 min
npm run a11y:scan -- states       # ~25 min
npm run a11y:scan -- modes        # ~20 min

npm run a11y:scan -- reflow       # diagnostics, seconds to a minute
npm run a11y:scan -- routes
npm run a11y:scan -- diff
npm run a11y:scan -- drift       # runs automatically before every scan above
npm run a11y:scan -- typecheck   # local only — see below
npm run a11y:scan -- selftest    # local only — see below
```

### No CI job type-checks this folder, or runs its selftest

`typecheck` and `selftest` are subcommands you have to remember, and that is a real
limitation rather than an oversight, so it is stated here rather than left implied.

The TypeScript in here imports `@playwright/test` and the two a11y-scout packages. All three
are installed `--no-save` and are absent in CI, so `tsc` there would fail on missing modules
instead of on our types. `scripts/beta-harness/spec-typecheck.mjs` also only discovers
configs under `apps/` and `libs/`, and Playwright's own runner strips types through esbuild
without checking them — a green suite run is not type safety.

The consequence: the compile-time guarantees this folder relies on — a mistyped journey
screen id or interaction state being a build error — hold **only when someone runs this
command**. Run it before pushing. Flagged in review on PR #225.

`selftest` is local-only for a different reason: it needs nothing installed and would run
anywhere, but `review:preflight` lists each `*.selftest.mjs` by name and this folder is
deliberately absent from every CI job, so wiring it in would couple a folder designed to be
deleted in two edits to a gate outside it. It covers `cli-args.mjs` — the `--project` scope
check, every grep form, `--no-report` — because every defect review found in that code was
silent: a narrowed scan that wrote no report, a `--project` that ran another suite past the
wrong preflight. Run it with `typecheck` before pushing.

Extra arguments pass through, so a single screen with a visible browser is:

```bash
npm run a11y:scan -- journey --project=journey-01-login --headed
```

`--project` can only narrow a command, never switch it: `journey --project=surfaces` is
refused, because each command picks its own preflight checks and borrowing another suite's
project would skip them.

`surfaces`, `states` and `modes` write their consolidated report from a test of their own, so
**any** `--grep`, `-g`, `--grep-invert` or `-G` is refused — not just one calculated to exclude
it. No narrowing of these three leaves a passing report behind: that test asserts every
declared state recorded a scan, so a filter either removes it, giving no report silently
(`states --grep "column picker"` used to scan one state, pass, and write nothing), or keeps it
and fails it. Add `--no-report` to say you are watching one state rather than measuring; it
excludes that test for real rather than just labelling the run.
`journey` has no such trap: every screen emits its own report, so narrowing it is always safe.

Reports land in `reports/<name>-<timestamp>/` as `report.html`, `.md` and `.json`. The HTML is
self-contained — screenshots inlined — so it can be sent to whoever owns the screen.

## Nothing here gates anything

`failOnBlockers` is `false` everywhere. None of these findings are triaged, and a gate that
goes red on its first run for reasons nobody owns is one people learn to ignore —
`scripts/beta-harness/coverage-gate.mjs` carries the same warning and this repository has a
recorded case of CI
being red for sixteen consecutive runs over an unowned ceiling.

It also cannot run in CI today, for a reason that is about the backend rather than about
speed: the scan needs a live Nuxeo through the dev proxy, and this repository has no compose
file and no `packages.nuxeo.com` credentials. `.github/workflows/a11y.yml` records what would
change that. A second blocker is ours: a runner doing `npm ci` cannot resolve the a11y-scout
tarballs from any registry.

## Related, and deliberately not here

`docs/accessibility.md` is the **standard** — which of the four layers owns which verdict. It
stays in `docs/` because two of those layers, the static template scan (`npm run a11y`) and
the phase-6 axe gate, are permanent and CI-gated. Deleting this folder must not delete the
documentation for things that are not going anywhere.

## Removing this

Nothing under `apps/` or `libs/` was modified to support this folder, and the lockfile is
untouched. Removal is:

```bash
rm -rf a11y/ a11y-reports/
```

`a11y-reports/` is the second directory because a11y-scout writes its per-scan output to the
repository root and offers no way to redirect it: `generateReport()` takes an `outDir`,
`scanPage()` does not. That is also why removal touches one file more than `package.json`.

then:

1. delete the `"a11y:scan"` line from the root `package.json`;
2. delete the `/a11y-reports/` entry from the root `.gitignore`;
3. in `docs/accessibility.md`, remove the a11y-scout layer from the ownership table and the
   sections describing its findings — **edit, do not delete**: that file also documents the
   two layers that remain.

**Keep** the Definition-of-Done line this PR added to `AGENTS.md` ("`docs/accessibility.md`
consulted if an accessibility check was added, moved or suppressed"). It arrived with this
folder but is not about it: the static template scan and the phase-6 axe run stay, and the
one-owner-per-concern rule matters just as much for those two. This list used to say to
delete it, which would have dropped that reminder for the layers that remain. Flagged in
review on PR #225.

Leave the `a11y`, `a11y:all` and `a11y:baseline` scripts alone. They drive
`scripts/a11y-scan.mjs`, the static template scan, which predates this folder and is gated in
CI.

One deliberate duplication to know about if you are unpicking it: `installSession()` in
`fixtures.ts` is a copy of the same function in `apps/nuxeo-ui-e2e/src/fixtures.ts`. Sharing it
would have meant one definition but also one more thread to cut. A drifted copy would not
break authentication on its own: the app would sign in through `httpCredentials` and a cookie
session instead, and every scan would pass. So the `signedIn` fixture and the diagnostics
check that the app adopted the injected session (`session.mjs`), and fail if it did not.

One import does reach out of this folder, on purpose: `session.mjs` and the diagnostics use the
identity guard in `scripts/beta-harness/identity-guard.mjs` (NXSAT-643), which asks `/me` who a
scan actually ran as. It is shared with the phase runner and the e2e fixtures rather than copied,
because two copies of a security check are two things to keep right. Removing this folder leaves
it in place.
