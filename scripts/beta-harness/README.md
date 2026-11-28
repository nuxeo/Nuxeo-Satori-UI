# Beta harness

Tooling the AI agents use to execute the Nuxeo Satori Beta plan: per-phase
evidence capture with verification, and a re-runnable quality gate.

Related: `AGENTS/11-beta-program.md` (phase gates, agent roster, model policy)
and the `beta-phase` skill, which orchestrates both scripts.

Package tools are launched through `package-command.mjs` without a shell on every OS.
`spawnToolSync` returns a spawn-style error result when a tool cannot be resolved; invalid
shell options still throw. Sanitizer audit registry keys use `/` even when discovery or
TypeScript declarations supply Windows paths; filesystem operations retain native paths.
The platform jobs use the runtime pinned in `.nvmrc`. The Windows workflow explicitly builds
`nuxeo-ui` because an affected build need not select the application, whereas the bundle
gate always requires its output.
Both Windows verification and CodeQL run for PRs into `main` and `integration/**`; CodeQL also
runs for PRs into, and pushes to, `staging/**` (`staging/enterprise-grade-app`), which the
`code-scanning` gate needs there. Windows verification waits for CodeQL, so its branches stay
within CodeQL's. The Satori 1.0 branch was merged (NXSAT-673), so it is no longer a trigger.
Document-detail tests use native worker console streams rather than Vitest 4's console
RPC interception, which can reject a pending `onUserConsoleLog` during Windows teardown
even when every assertion passes (upstream vitest-dev/vitest#11153). Warnings and errors
remain visible; unhandled errors remain fatal. The Windows workflow runs
`node --test scripts/beta-harness/windows-console.selftest.mjs` to verify console output,
assertion failures and unhandled rejections before running the full gate.
The assertion audit also canonicalizes report keys before applying the legacy story-runner
scope exception; Windows separators must not impose the phase runner's identity contract
on `scripts/collect-evidence/`. Constant-condition checks still apply to both runners.

`npm run beta:e2e-negative-control` uses the portable Node runner (the `.sh` file is only
a compatibility wrapper). It preserves separate baseline/starved reports and artifacts,
sets `E2E_STARVE_APP=0/1` explicitly, disables retries, and delegates the data-sensitivity
verdict to `vacuity-verdict.mjs`. Invalid credentials are not a useful perturbation because
the identity guard fails before spec assertions run.

## How this differs from `scripts/collect-evidence/`

|              | `collect-evidence/`              | `beta-harness/`                                    |
| ------------ | -------------------------------- | -------------------------------------------------- |
| Unit of work | one JIRA ticket                  | one Beta phase                                     |
| Output       | screenshots + video              | screenshots + video + `manifest.json` + `INDEX.md` |
| Verification | none — captures whatever renders | every step records pass/fail checks                |
| Exit code    | always 0                         | 0 pass, 1 fail, 2 precondition not met             |

The helper contract (`step`, `screenshot`, `login`, `goToDoc`, `baseUrl`) is a
superset of the ticket runner's, so existing ticket steps files run unchanged
under the phase runner.

## Prerequisites

Playwright and axe are deliberately **not** tracked dependencies, so they never
affect the CI install. Install them locally once:

```bash
npm install --no-save @playwright/test @axe-core/playwright
npx playwright install chromium
```

**Install them in the same command.** `npm install --no-save <x>` reconciles
`node_modules` against the lockfile plus `<x>`, which silently removes any _other_
unsaved package. Installing axe on its own deleted Playwright and the next capture
died with "Playwright is required to capture evidence but is not installed".

Bring the Nuxeo stack up, then start the app in another terminal:

```bash
npm run beta:backend      # starts the nuxeo + nuxeo-opensearch containers, waits for the API
npx nx serve nuxeo-ui
```

### `beta:backend`

Starts the containers if they are stopped and **waits until Nuxeo actually answers
`/nuxeo/api/v1/me`**, not merely until `docker start` returns — that comes back in
milliseconds while Nuxeo takes tens of seconds to deploy, and a capture launched
into that window fails on half-initialised surfaces.

Without it, a stopped container surfaced as a dozen scattered "selector not
visible" failures, which reads exactly like a broken component. One sentence at the
top beats twelve reds at the bottom.

```bash
npm run beta:backend                 # start if needed, then wait
npm run beta:backend -- --check      # report only, change nothing
EVIDENCE_ENSURE_BACKEND=1 npm run beta:evidence -- phase-0-baseline   # do it inline
```

`EVIDENCE_ENSURE_BACKEND` is opt-in on purpose: starting containers is a side
effect a capture should not have by surprise, and `phase-0-no-backend` needs the
opposite of a running backend.

It fails with a specific reason rather than a generic timeout — Docker CLI absent,
daemon not running, container absent (with the env var to point at yours, since
this repo has no compose file), start failed, or API never came up (with the
`docker logs` command to run next).

| Variable               | Default                 |
| ---------------------- | ----------------------- |
| `NUXEO_CONTAINER`      | `nuxeo`                 |
| `OPENSEARCH_CONTAINER` | `nuxeo-opensearch`      |
| `NUXEO_URL`            | `http://localhost:8080` |
| `BACKEND_WAIT_SECONDS` | `180`                   |

## Capture phase evidence

```bash
npm run beta:evidence -- phase-0-baseline
```

Loads `scripts/beta-harness/steps/phase-0-baseline.mjs` and writes to
`$EVIDENCE_ROOT/beta/phase-0-baseline/<timestamp>/`:

- `NN-*.png` — screenshots numbered by step
- `*.webm` — video of the whole run
- `manifest.json` — steps, checks, environment, screenshot audit, verdict
- `INDEX.md` — narrative report with the images inlined, ready to paste into a
  PR description or attach to the RFC

Exit codes:

| Code | Verdict                | What to do                                                          |
| ---- | ---------------------- | ------------------------------------------------------------------- |
| 0    | `pass`                 | Done.                                                               |
| 1    | `fail` / `error`       | Iterate. Something is broken.                                       |
| 2    | `precondition-not-met` | **Do not iterate.** Fix the environment, or run another steps file. |

A run with **no** checks at all also exits non-zero — a capture that asserts
nothing is not evidence.

### Preconditions, and why the distinction earns its keep

`h.requirePrecondition(name, condition, detail)` records the condition as a check
and aborts the run if it does not hold.

The `phase-0-no-backend` run of 2026-08-20T23-55-38 is why this exists. It reads
`verdict: fail`, `9 of 13 checks failed`, with failures about auth guards not
redirecting and the login page not rendering. Every one of them had a single cause:
Nuxeo was running, and that steps file asserts it is **not** — its own header says
it "fails by design" against a live backend. Nothing in the report distinguished
one precondition mismatch from nine real defects, and the obvious response to nine
red auth-guard checks is to go change the auth guard.

A precondition mismatch now aborts on the first step with its own verdict and its
own exit code, and says what to run instead.

### The identity guard

Some Nuxeo servers have anonymous authentication switched on — the shared local one does. They
answer a request whose credentials did not arrive `200` as `Anonymous` instead of refusing it, so
a status code, a non-empty result and a rendered page all look the same either way, and a
permission check can pass because a guest can do nothing. `identity-guard.mjs` asks
`/nuxeo/api/v1/me` who the request ran as, through the channel the result came from, and rejects
`Anonymous`, another user, or no answer (NXSAT-643).

In the runner it checks `page.request` before the first step, and `page.request` plus the app in
the page — its stored session, and `/me` asked with the header that session sends, from inside the
page and replayed from Node with the browser's cookies — at every step boundary and after the
last step. An in-page answer must come from a server (a `page.route` that fulfils `/me` is
refused), every probe goes to the app's own origin, no probe follows a redirect, and an app that
sends Nuxeo API requests to another origin is refused rather than judged on the wrong server. User
ids compare exactly.

`/me` vouches only for the header it was asked with, so the requests the page itself sent are
judged too. Every `fetch` or XHR the page sent to `/nuxeo/` since its session was installed must
have gone out with the session's header, read after any `page.route` rewrite. One without it, or
with another user's, is rejected. Neither a reload nor a later request that carried the header
excuses it.

The session counts as installed at one of three points:

- the start of the page, for a session injected before the page loads;
- the reload `h.login()` makes, so the signed-out boot before it is not judged. A script that signs
  in by reload outside the runner calls `restartAtNextLoad()` on its watcher first;
- a declared switch.

Before a form sign-in has been seen, and only then, the requests before the first that carried the
header are excused. The configuration service's files under `/nuxeo/agentic-ui-config/` are read
without the header by design, so they are not judged.

A rejection makes the run `precondition-not-met` (exit 2), marks
`manifest.identity.valid: false`, and records the failed check on the step whose result is
invalid. So:

- **`await h.step(...);`, as a statement of its own.** The boundary check is asynchronous; not
  awaited, it runs alongside the next step and cannot speak for its own. `npm run beta:audit`
  refuses any other form in `steps/` — a `.then()` chain, `Promise.all`, an alias — because a
  discarded `Promise.all([h.step(...)])` looks to the runtime exactly like an `await`. At run time
  a boundary nothing awaited in time is still recorded as a failed check on its step, and the run
  ends `precondition-not-met`.
- **A steps file's own in-page `fetch` to `/nuxeo/` sends the session's header**, as the app's
  interceptor does. The guard cannot tell it from the app's requests, and one without the header
  ran as whoever the cookies say.
- **Say when the browser is meant to be someone else**: `await h.signedInAs(user, reason)` before
  the next boundary. The switch is listed in `INDEX.md`; an unannounced one is rejected.
- **Say when it is meant to be signed out**: `await h.signedOut(reason)`. Once a run has signed
  in, a boundary that finds no session, or a page off the app, is rejected — losing the session is
  one way to hide a result obtained as someone else. Before the first sign-in both are accepted.
- **Declare a transition before you make it, and await it.** `h.signedInAs`, `h.signedOut` and
  `h.login()` each restart the window of requests the next boundary judges, so they first ask
  Nuxeo who the outgoing session's requests ran as: a step that read anything headerless is
  refused there rather than discarded. Two consequences. The new session must not be installed
  yet, or it is what gets judged — against the user it replaces. And the call must be awaited as a
  statement; `npm run beta:audit` fails a floating one, because discarding that promise would skip
  the verification in silence.
- **`page.request` always sends the run's own user.** The context's `httpCredentials` use
  `send: 'always'`, which replaces an explicit `Authorization` on the request. A second API
  identity needs its own `request.newContext()` or Node `fetch`.
- **`h.login()` clears cookies** before it signs in, so a guest session cannot be adopted.

Its controls:

```bash
npm run beta:identity-guard-selftest     # offline: the judgement and the step wiring
APP_URL=… npm run beta:identity-guard-controls   # live, needs a guest-enabled Nuxeo
```

On Node 25, run the selftest with `NODE_OPTIONS=--no-experimental-webstorage`. Without the flag,
its fake page reads Node 25's built-in `localStorage` (measured on 25.2.0), which throws unless
Node was given `--localstorage-file`, and the run stops on a `PreconditionError` that quotes that
message. That is the selftest, not the guard.

The live controls run `fixtures/identity-guard/control.steps.mjs` through the real runner three
times: no fault must pass; credentials dropped mid-run, and a guest cookie adopted mid-run, must
each end `precondition-not-met` while every check of the steps' own passes — without the guard
both would have been green.

#### What talks to Nuxeo, and how it is guarded

| Harness                                                                                               | Credentials on every request                       | Identity checked                                                                         |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `phase-runner.mjs` + `steps/*.mjs`                                                                    | `page.request`: `send: 'always'`; app: its session | start, every step boundary, end                                                          |
| `steps/nxsat-308-parity/seed-parity-data.mjs`                                                         | explicit header, Node `fetch`                      | before the first write, after verifying                                                  |
| `backend-preflight.mjs`, `e2e-preflight.mjs`, `a11y/preflight.mjs`                                    | explicit header, Node `fetch`                      | `/me` by name, before any data check                                                     |
| `apps/nuxeo-ui-e2e` (`signedIn`, `newNuxeoApiContext`)                                                | `send: 'always'`; API contexts: explicit header    | `signedIn`: both channels before and after every test; an API context once, when created |
| `a11y/` suites (`signedIn`) and `a11y/diagnostics/*`                                                  | `send: 'always'`; diagnostics: explicit header     | both channels before and after every test; diagnostics once, after sign-in               |
| `scripts/collect-evidence/story-runner.mjs`, `annotate-showcase.mjs`, `scripts/demo-deck/capture.mjs` | `send: 'always'`                                   | not by this guard (`capture.mjs` checks `/me` itself)                                    |
| `libs/integration-tests`, `apps/nuxeo-ui/e2e/*.mjs`, `tools/video`, `tools/i18n`                      | explicit header or the app's session               | not by this guard                                                                        |

The last two rows are named, not covered: they predate the guard and are follow-ups.

### Notes are not checks

`h.note(text)` records something a run deliberately does **not** cover. Use it
instead of `h.check(name, true)`, which cannot fail: it certifies nothing while
adding to the total. The Phase 1 review named that pattern as a defect after two
checks "certified properties they could not observe" — one of them tautological,
and it missed the very failure it appeared to guard. Notes render in `INDEX.md` as
`_not covered:_` and stay out of the count.

### Screenshot audit

Every run hashes its own screenshots and reports how many distinct images it
actually produced. This exists because the evidence corpus is full of runs where
it was fewer than the filenames implied: one _passing_ `phase-0-no-backend` run
had five differently-named screenshots that were a single image, and a Phase 2
closure bundle presented sixteen shots that were ten pictures — including
`07-manifest-relabels-nav.png`, byte-identical to the default-manifest shot and
showing a collapsed icon rail with no labels on it at all. A reviewer counting
images in `INDEX.md` read sixteen observations and got ten.

Duplicates are not automatically wrong: a "malformed config falls back to the
packaged surface" step _should_ look like the default. But then the image carries
no discriminating information while its filename implies it does, so the audit
prints the duplicate groups and the assertion has to come from the DOM checks.

- Default: duplicates are reported; the run fails only if **every** screenshot is
  the same image, which cannot be a legitimate multi-step capture.
- `EVIDENCE_STRICT_SCREENSHOTS=1`: **any** duplicate group fails the run. Use it
  for a phase whose steps each claim a distinct visual observation.

**Read `unique` as a lower bound on duplication, not as a count of distinct
observations.** Byte-identity has no false positives, but it under-reports: the
pilot capture reported 6 unique of 6 while two of its PNGs were visually
indistinguishable at 66415 against 66416 bytes — one byte apart. So a clean audit
does not license "every screenshot shows something new"; only the flagged groups
are load-bearing. A perceptual hash would be stronger and this is not one.

To add a phase, copy `steps/_template.mjs` to `steps/<phase-id>.mjs`. The
template documents the six rules that keep a capture meaningful.

## Run the verification gate

```bash
npm run beta:gate -- --phase phase-1-config
npm run beta:gate -- --gates guardrails,lint        # fast inner loop
npm run beta:gate -- --base main --tail 80
```

Every gate in `ALL_GATES` (32 today — an unknown `--gates` id prints the current
list), cheapest first, stopping at the first failure and printing only its output
tail: `node`, the `lockfile` and `dependency-tree` pairs, `supply-chain`,
`code-scanning`, the guardrails and sanitizer pairs, `assertions`, the
`parity-surface` pair, then affected
`lint`, `test`, `build`, `typecheck`, then `spec-types`, `bundle` and the packaging
and drift gates. [Dev Harness & Gates](../../documentation/30-engineering/08-dev-harness-and-gates.md)
has the table. That ordering is deliberate — a lint error usually explains the test
failure that would follow, and running the full set on a known-broken tree wastes
minutes per iteration.

`dependency-tree` is **blocking** (`BLOCKING = true` in `dependency-tree.mjs`): any finding for a
retired dependency (the legacy UI libraries, `js-api` or `hxcs-js-client`) fails it.

Reports land in `$EVIDENCE_ROOT/beta/gates/<timestamp>-<phase>.json`.

Four further checks are **not** in the pipeline, because they need something the
pipeline cannot assume — a measurement run, a browser, or evidence that lives outside the repo:

| Command                          | Checks                                                                   | Why it is separate                                                                            |
| -------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `npm run beta:coverage`          | no project lost coverage; `FLOORS` met                                   | needs a `--coverage` run first; CI runs it after Sonar's tests, `--expect-all`                |
| `npm run beta:state`             | every "complete" phase cites a passing manifest                          | evidence lives outside the tree, so this is local-only and cannot run in CI                   |
| `npm run beta:backend`           | the Nuxeo stack is up and serving                                        | starts containers; a side effect a gate should not have                                       |
| `npm run beta:asset-performance` | the brand assets library at 100,000 assets within its budget             | needs Chromium and a production build; CI runs only its offline controls (section below)      |
| `npm run beta:page-budgets`      | the home, a queue's first page and a record page within their CI budgets | needs Chromium and a production build; CI's `performance-budgets` job runs it (section below) |
| `npm run beta:bundle-budgets`    | the initial bundle and each lazy chunk within their sizes                | needs a production build with `--stats-json`; the same job runs it                            |

### The asset library's performance check

`asset-performance/` holds the brand assets library and its asset page to the budget in
[`docs/business-apps/performance-budget.md`](../../docs/business-apps/performance-budget.md), at
100,000 synthetic assets, without a Nuxeo. `check.mjs` builds the app for production, serves it on
port 4294 with `stand-in.mjs`, a stand-in for every REST call the two pages make, answering from
`library.mjs`'s synthetic library after a stated latency, and measures them in Chromium. The
stand-in keeps to OpenSearch's result window as Nuxeo does, refusing a page that ends past the
10,000th result, and the check pages the library to that edge. It needs Playwright
(Prerequisites, above) and no credentials. Exit codes are the runner's: 0, 1, 2.

```bash
npm run beta:asset-performance                    # build, measure, judge against budget.json
npm run beta:asset-performance -- --skip-build    # the build already in dist/nuxeo-ui
npm run beta:asset-performance-controls           # eight controls, each must fail its own lines
npm run beta:asset-performance-selftest           # offline, in CI: library, stand-in, budget
```

Its report goes to `$EVIDENCE_ROOT/beta/asset-performance/<timestamp>/`. It does not measure
Nuxeo's or OpenSearch's own query time at 100,000 documents: the stand-in's latencies are stated
assumptions, which a server holding that data would confirm.

### The performance budgets in CI

`performance-budgets/` holds the app to phase 10's budgets,
[`docs/business-apps/performance-budgets-ci.md`](../../docs/business-apps/performance-budgets-ci.md):
`bundles.mjs` the initial bundle and each lazy chunk, by size, from the build's esbuild metafile;
`pages.mjs` three pages' first render in Chromium, the median of five cold loads, against the asset
check's stand-in (port 4295). Exit codes are the runner's: 0 within budget, 1 over it, each line
named with its number and its budget, 2 a precondition not met. CI's `performance-budgets` job runs
all four:

```bash
npx nx run nuxeo-ui:build:production --stats-json
npm run beta:budgets-selftest                      # offline: judgement, metafile, controls, doc, job
npm run beta:bundle-budgets -- --report /tmp/bundles.json
npm run beta:page-budgets -- --skip-build --report /tmp/pages.json
npm run beta:budgets-controls -- --bundles /tmp/bundles.json --pages /tmp/pages.json --run-checks
```

`--lower <budget>=<limit>` sets one budget on purpose, for a control: the run must then fail on it.
`pages.mjs` loads each page once, unmeasured, before the measured runs (`--no-warmup` skips it),
waits for each navigation to commit rather than for the `load` event, and tries a navigation that
did not commit once more, saying so; `--stall-navigations <n|all>` with `--navigation-timeout <ms>`
holds measured navigations on purpose, to see that retry pass once and fail twice.

### The `assertions` gate

`npm run beta:audit` parses every steps file and fails on an assertion whose
condition **cannot be false**. The other seven gates all check the _application_;
nothing checked whether the _evidence_ was capable of failing, and that is where
this programme's worst defect got through — Phase 1 shipped past two checks that
"certified properties they could not observe", one of which was tautological and
"did not catch defect 1, which is precisely the failure it appeared to guard".

It catches literal conditions, constants bound to a name, `Boolean(<constant>)`,
two literals compared, a missing condition, and self-comparison — including the two
real shapes from this repo, `'main.js' === 'main.js'` and `check('… NOT covered', true)`.
It also prints every `expectNoConsoleErrors` suppression in force, resolved through
module-level consts, so blind spots are visible in one place. Four of five steps
files suppress Phase 1's own deliverables.

It cannot tell you whether a falsifiable assertion asserts the _right_ thing. That
is `AGENTS/12-review-agents.md`.

### The `parity-surface` gate

`npm run beta:parity-surface` audits the one steps file that captures the same claims
twice — `steps/nxsat-308-parity.mjs`, on a reference surface and on the `nxs-` components.
The reference half cannot be captured again, so that file's rule is that the steps and the
expected values are written once and only the **surface adapter** changes between the halves.

Nothing enforced the rule, and the `nxs` run was unable to finish for two months. A
breadcrumb crumb was selected by its label; the label was itself under test, so the one
real defect — a trail labelled with path segments rather than document titles — became a
30 s `locator.click` timeout, `verdict: error`, and eleven of twenty-four steps that never
ran. Separately, the fallback element, the properties labels, the search page size, how a
search is submitted, the no-results wording and how a permission option is chosen were all
written into the step bodies as one surface's answer, and each read as a parity failure on a
surface that behaved correctly. One was worse than a false red: a permission option matched
by its translated label staged nothing, so the save under test never ran — and the check
that `AddChildren` survived it passed against an untouched ACL.

Three rules, one per failure: `unguarded-click` (a `.click()` with no `.catch()`),
`surface-selector-in-step` (a selector naming a component-library prefix such as `nxs-`, `sat-` or `lib-`
from outside an adapter, in the runner or inside a `page.evaluate`), and `adapter-gap`
(a surface missing an adapter key the steps read). A helper that only the adapters call
counts as adapter code; one the steps also call does not.

It does not decide a surface-specific CSS class with no element prefix, and it cannot
tell you whether an adapter's selector matches anything on the running app — `nxs-breadcrumbs`
was a real element of this repository and matched nothing, because `app.config.ts`
re-registers that primitive on Satori. Both limits are printed on every run.
`npm run beta:parity-surface-selftest` is its negative controls; they are synthetic files in
a temporary directory, so unlike the sanitizer controls they cannot leave the tree dirty.

`npm run beta:parity-selftest` is the other half, and it answers the question the audit
structurally cannot: not whether the file has the right shape, but whether a verdict in it is
capable of being wrong. It runs step 11's `aclSaveVerdict` in process against each situation the
step can observe — nothing staged, the happy path, the entry dropped, the Save counted after the
click, a click that never reached the wire, an unrelated write in the same window — and prints
beside each what the predicate that used to be there would have concluded. Four of the six passed
that old predicate with nothing saved. Both are gates (`parity-surface-selftest`,
`parity-selftest`) and both run in `ci.yml`.

### Coverage ratchet

The Beta bar is 90%. Nothing is near it — `search` is at 22.8%, `document-detail`
at 29.8% — so a gate at 90% would be red until Phase 6, get bypassed, and then get
ignored. Instead `beta:coverage` records each project in
`.ai/state/coverage-baseline.json` and fails when one goes **backwards** by more
than 0.5pp, printing how far each still is from 90%. A project named in `FLOORS` is held to a
fixed floor instead — `satori-components` at 90% of lines from its first commit, with no file
allowed outside the measurement and no stale report, including one that counts a deleted file.

```bash
npm run beta:coverage -- --run               # run the tests, then check the ratchet
npm run beta:coverage -- --expect-all        # after a run of every project, as in CI
npm run beta:coverage -- --update-baseline   # lock in a rise
```

`nuxeo-ui` is excluded and says so on every run: its Karma builder takes
`--code-coverage`, not `--coverage.enabled`, and errors on the latter.

A run is **partial** by default: a Vitest project with no report is taken to be outside the
affected set and passes, which is what `nx test <project> --coverage.enabled=true` followed by
the gate needs. `--expect-all` says the run covered every Vitest project, and makes a project
with no usable report — none, unparsable, or listing no files — a blocking failure, baselined or
not. `--run` implies it. SonarCloud passes it, because Vitest writes no report for a project
whose tests fail and its test step is `run-many` with `continue-on-error`: on PR #679
`shared-queues` and `studio-migration` were red there and the gate passed without naming them.
`coverage.reportOnFailure` stays off on purpose — it would turn a red suite into a number the
ratchet compares and `--update-baseline` records. A full run also fails an `@nx/vitest:test`
target with no `reportsDirectory`, whose report the gate cannot look for. A baselined project no
run can measure — no `test` target, a Karma target, or no `reportsDirectory` — fails every run,
and is never pruned as an orphan: renaming a target to `unit-test` used to drop the project from
the ratchet with exit 0. `--update-baseline` refuses to write while any of these stand. An
unknown argument is refused, so a misspelt `--expect-all` cannot quietly make a run partial.

`--update-baseline` keeps an entry whose fall is within the 0.5pp tolerance, and records rises,
new projects, the denominator expansions the gate reports and — as before, and against the
gate's own advice — a regression beyond the tolerance. Rewriting every measured project moved
the high-water mark down with the noise: PR #682's write lowered `satori-components`, `search`
and `shared-app-config` by up to 0.39pp, though the gate had asked for none of it. When the
denominator grew, only the percentages are kept; the counts move forward, because they are what
tells a later deletion of tests from an expansion.

A `noStatements` exemption is checked against the source as well as the report. It covers types,
`export *` barrels and constant tables. A file no spec imports has an empty coverage map whatever
it holds, so one that gained a function stayed exempt. Now the gate reads the syntax and fails a
function or class anywhere; a top-level statement other than an import, export, type, enum,
`declare` form, type-only namespace or variable; and inside the data, a call (except
`Object.freeze`), `new` (except `InjectionToken`), a tagged template, `await`, a conditional,
`&&`/`||`/`??`, an assignment, a comma, `++`/`--`, `delete` or `?.`. A property read is not caught.
Eager route arrays and descriptor tables pass; a lazy `loadComponent: () => import(...)` does not.
An allowlist entry is called stale only when the run can tell: not under a Vitest project that
wrote no report, nor under a baselined project no run can measure.

`npm run beta:coverage-selftest` holds all of this, and SonarCloud's flag, in place; it runs in
`ci.yml`.

### Accessibility

`h.expectNoA11yViolations()` scans the current page with axe against
`wcag2a/wcag2aa/wcag21a/wcag21aa`. Only `serious` and `critical` impacts fail;
everything found is recorded as a note either way. `steps/phase-6-a11y.mjs` is the
slice baseline and uses the same ratchet — four rules are currently violated
(`button-name`, `color-contrast`, `role-img-alt`, `label`), listed with node counts
and excluded from the verdict, so a **new** violation is distinguishable from the
existing gap.

If axe is missing, the check **fails** rather than skipping. A run that claims an
accessibility assertion and quietly made none is worse than a red.

### Gate zero: the Node preflight

`node-version.mjs` runs first because a wrong Node major produces a red that is
indistinguishable from a code defect, and the obvious response — edit the failing
spec — damages working code. That happened: an agent on Node 25 saw
`clipboard.utils.spec.ts` throw `SecurityError: Cannot initialize local storage
without a --localstorage-file path` and reported a product defect. Node 25 defines
a global `localStorage` that throws unless given a store path, and it shadows
jsdom's, so a correct spec fails.

It probes the runtime's behaviour rather than consulting a version table, and
reports one of three outcomes:

- **supported** — the pinned major. Nothing to say.
- **mitigated** — a newer major with a hazard the gate works around. Passes, and
  warns that commands run _outside_ the gate do not get the workaround.
- **unsupported** — older than the pinned major, or a hazard with no workaround.
  Fails, because nothing downstream can be interpreted.

Run it alone before any bare `nx` command: `node scripts/beta-harness/node-version.mjs`.

### Partial runs cannot be quoted as green

`--gates` is a fast inner loop, not a phase gate, so the report says which gates
were never asked for and the verdict carries the coverage:

```text
verdict  PASS (PARTIAL) — 2 of 8 gates green
         NOT REQUESTED: lockfile, assertions, lint, test, build, typecheck
```

The JSON records `verdict: "pass-partial"` plus a `gates` object with
`available`, `requested`, `ran` (reached a verdict), `notRun`, `skipped` (selected but
never reached, because an earlier gate failed) and `notRequested`, and a `counts` object. Two reports in the evidence corpus read
`"verdict": "pass"` having run a single gate — `skipped` was empty because the
other five were never _selected_ — so nothing distinguished them from a full green
except counting `results` by hand. Only `verdict: "pass"` may be cited for a phase.

### A gate that did not run is not green

A gate can say it checked nothing by exiting `NOT_RUN_EXIT_CODE` (78, in `gate-summary.mjs`),
if its entry declares `mayNotRun`. Only `code-scanning` does, when `BETA_SKIP_CODE_SCANNING=1`.
The runner records it as NOT RUN, carries on, and a full run is then `pass-incomplete`:

```text
verdict  PASS (INCOMPLETE) — 28 green, 1 NOT RUN (code-scanning)
```

`npm run beta:gate-selftest` holds the runner to this, against the real runner and gate.

### Do not force-kill a run: one selftest perturbs tracked source

**Exactly one** — `sanitizer-audit.selftest.mjs`. It proves its check by editing real files,
asserting the audit goes red for the stated reason, and restoring them. Every other selftest that
writes at all writes to a temporary directory and says so in its own docstring:
`parity-surface-audit.selftest.mjs` with "Nothing tracked is touched",
`review-guardrails.selftest.mjs` with "nothing outside that directory is ever written".

So do not scope this by searching for writers. `grep -lE "writeFileSync" scripts/**/*.selftest.mjs`
returns eighteen files and seventeen of them are harmless — an earlier revision of this section
said "eighteen selftests break real source" on exactly that basis, which overstated the hazard by
a factor of eighteen. The honest test is `mkdtemp`: everything except the sanitizer selftest uses
one.

The restore is well defended — a `finally`, plus `SIGINT`/`SIGTERM`/`SIGHUP` and
`uncaughtException` handlers for the paths `finally` misses. Its own docstring says where that
ends: **"SIGKILL and power loss remain uncatchable"**. A forced stop — `kill -9`, an agent harness
cancelling a background task, a crashed terminal — is the case no handler covers, and it leaves
the perturbation in tracked source.

#### What the next run does with a leftover, which is the dangerous part

`edit()` captures `original = backups.get(relPath)?.original ?? current` — the first time a run
touches a file, "original" is **whatever is on disk at that moment**. So a run starting on a dirty
tree can adopt the leftover as the pristine state and faithfully restore to it, leaving the
perturbation in place and no longer flagged by anything. That is the quiet outcome and the worst
one.

The louder outcomes:

- It throws on an anchor that the leftover already changed —
  `document-viewer posterUrl changed — update these controls` — which reads as a stale control
  rather than a dirty tree, so the obvious next move is to "fix" a control that was never wrong.
- `git add -A` commits it. The perturbations are plausible code, and one swaps `templateUrl` for
  an inline `template`, so in review it reads as deliberate rather than as scaffolding.

**Do not rely on the `NOT restoring … changed by something else mid-run` warning to tell you.**
That is a _concurrent-edit_ safeguard: `restoreAll()` compares the bytes on disk against what this
run wrote, so it fires when something edits a file **during** the run — an IDE save mid-control —
and is silent about a tree that was already dirty when the run began. It may never appear in the
case you need it for.

#### Recovery

Look before you restore, and look in two places:

```bash
git diff -- <path>           # unstaged: the leftover, possibly mixed with your own edits
git diff --cached -- <path>  # staged: if the perturbation is here, checkout RESTORES it
```

`git checkout -- <path>` takes the file from the **index**, so it reinstates a staged perturbation
and discards unstaged work in the same file. Reach for it only when the unstaged change is purely
the leftover and the index is known good. Otherwise restore from a ref —
`git checkout <ref> -- <path>` — or remove just the perturbation by hand and keep your own edits.

Both mistakes above were made on [#522](https://github.com/nuxeo/Nuxeo-Satori-UI/pull/522): a gate
stopped twice mid-selftest, then `git add -A`, and the perturbation reached a commit and a pushed
branch. It was caught by the gate rather than by the author.

## The end-to-end suite

`apps/nuxeo-ui-e2e` is Playwright against a live Nuxeo, through the served app. It is not one of
`beta:gate`'s gates, which have no "precondition not met" path; it runs in three places:

| Where                                                                        | What                                         | Against                              |
| ---------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| `npm run beta:e2e`, `npm run beta:e2e-smoke`                                 | the whole suite, or the `@smoke` tests alone | the local stack, `E2E_BASE_URL`      |
| [`e2e-smoke.yml`](../../.github/workflows/e2e-smoke.yml), every pull request | the `@smoke` tests, Chromium                 | the hosted Nuxeo, `NUXEO_E2E_TARGET` |
| [`e2e-nightly.yml`](../../.github/workflows/e2e-nightly.yml), 03:00 UTC      | the whole suite, Chromium and WebKit         | the hosted Nuxeo                     |

**The smoke run on pull requests** into `main`, `integration/**` and `staging/**` runs the tests
tagged `SMOKE` (`apps/nuxeo-ui-e2e/src/smoke.ts`, which lists them and why), selected with
`--grep @smoke` on the `chromium` project. Its steps, in order:

1. **The secrets,** `NUXEO_E2E_TARGET`, `NUXEO_USER`, `NUXEO_PASS` and `SATORI_GH_READONLY_TOKEN`. A
   pull request from a fork, or Dependabot's, has none of them: its `E2E smoke (chromium)` job is
   skipped, which shows grey and never green, and the `E2E smoke not run (no secrets)` job says why
   in a notice and the run's summary. A Dependabot update is smoke-tested only once someone pushes to
   its branch. On this repository's own branches a missing secret fails.
2. `e2e-preflight.mjs`, with `E2E_BROWSERS=chromium`, so it launches only the engine the run uses.
3. Playwright, with `--trace off` and a deadline of its own, then **`e2e-smoke-verdict.mjs`** on its
   report. Playwright 1.63.0 exits 0 when a test skips itself (measured), and 1 when a `--grep`
   matches nothing, which a `--pass-with-no-tests` would turn to 0. The verdict refuses a report with
   fewer tests than `--min`, the subset's size, 16, a test not tagged `@smoke`, one on another
   project, and one that did not pass. A test that passed on a retry passes and is named in the
   summary.
   **No trace, no page snapshot:** a Playwright trace holds the browser context's options,
   `httpCredentials` and so `NUXEO_PASS` among them, in plain text, and the value of every field a
   test fills, measured with 1.63.0 on 28 November 2026; and the page snapshot a failed test's
   `error-context.md` carries holds a filled field's value. This repository is public and its
   artifacts can be downloaded by anyone signed in, so both CI runs pass `--trace off` and set
   `PLAYWRIGHT_NO_COPY_PROMPT`, which leaves `error-context.md` without the page. The nightly's
   failing runs before 28 November uploaded traces: their artifacts, kept 14 days, and the password
   are for an administrator to delete and rotate.
4. **`e2e-sweep.mjs`,** on every outcome once the app was served, cancellation included. Every
   title the smoke specs make, through `uniqueTitle`, starts with the run's `E2E_RUN_PREFIX`,
   `e2e-pr<number>-<run>-<attempt>-`, and the sweep trashes whatever live document still carries
   it. The specs delete their own; this is for a run stopped before they could. The prefix's shape
   is checked before anything is written, since the sweep's `LIKE '<prefix>%'` is all that keeps it
   off every other document.

**Serialised:** a new push cancels the pull request's run in progress, and across pull requests
the smoke job runs in one concurrency group, `e2e-hosted-nuxeo-smoke`, one at a time. GitHub keeps
one run waiting per group, so a third pull request's run cancels the waiting one, which shows as
cancelled until it is re-run. The nightly keeps its own groups, and its dispatched branches run at
the same time as each other: a smoke run may overlap them, which is accepted. The prefix and the
specs' random suffixes keep their documents apart; the server's load and the account are shared.

**Required, or not:** a check is required when a branch protection rule or a ruleset on the target
branch names it, `E2E smoke (chromium)` here. That is an administrator's setting, not a file, and
none names it yet. A required check that is skipped counts as passed, which is what lets a fork's
pull request merge without the secrets.

Its controls, `npm run beta:e2e-smoke-selftest`, run in `ci.yml`'s guardrails job on every pull
request, forks' included, with Node alone: the prefix's shape, the verdict run on reports written
for the purpose, the sweep against a stand-in Nuxeo on a local port, and `e2e-smoke.yml`'s own text,
each part broken in a copy and refused. Locally, `E2E_BROWSERS=chromium npm run beta:e2e-smoke`
runs the subset against the local stack.

## Environment

| Variable                      | Default                         | Purpose                                              |
| ----------------------------- | ------------------------------- | ---------------------------------------------------- |
| `APP_URL`                     | `http://localhost:4200`         | Dev server URL                                       |
| `NUXEO_USER`                  | _(required — no default)_       | Login username                                       |
| `NUXEO_PASS`                  | _(required — no default)_       | Login password                                       |
| `NUXEO_DOC_UID`               | _(none)_                        | Document UID for doc-specific steps                  |
| `AGENTIC_UI_EVIDENCE_DIR`     | `~/Desktop/agentic-ui-evidence` | Evidence root                                        |
| `EVIDENCE_HEADLESS`           | `0`                             | Set `1` to run without a visible browser             |
| `EVIDENCE_SLOWMO`             | `300`                           | Milliseconds between interactions                    |
| `EVIDENCE_STRICT_SCREENSHOTS` | `0`                             | Set `1` to fail on any byte-identical screenshots    |
| `BETA_GATE_NODE_STRICT`       | `0`                             | Set `1` to fail on any Node major but the pinned one |

Credentials come from the environment only. Never commit real ones.

`NUXEO_USER` and `NUXEO_PASS` have **no default**. `backend-preflight.mjs` and
`annotate-showcase.mjs` exit **2** — precondition not met — when either is unset, and so does the
runner, before launching a browser, for a steps file that needs them; `h.login()` throws a
`PreconditionError`. A steps file that needs no backend exports `skipHttpCredentials = true` (as
`phase-0-no-backend` and `phase-4-platform` do) and runs with no credentials at all. A steps file
that fails to load is reported as that load error, not as missing credentials.
`story-runner.mjs` under `scripts/collect-evidence/` refuses a missing pair with exit 2 too, but
a scenes file's own `PreconditionError` ends that run with exit 1.

Both variables used to default to `Administrator` (NXSAT-649): a working login in the
repository, and a capture that silently ran as an administrator whenever the variables were
unset. The shared reader is `nuxeo-credentials.mjs`.
