# Beta harness

Tooling the AI agents use to execute the Nuxeo Satori Beta plan: per-phase
evidence capture with verification, and a re-runnable quality gate.

Related: `AGENTS/11-beta-program.md` (phase gates, agent roster, model policy)
and the `beta-phase` skill, which orchestrates both scripts.

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
refused), every probe goes to the app's own origin, and an app that sends Nuxeo API requests to
another origin is refused rather than judged on the wrong server. User ids compare exactly.

A rejection makes the run `precondition-not-met` (exit 2), marks
`manifest.identity.valid: false`, and records the failed check on the step whose result is
invalid. So:

- **`await h.step(...)`.** The boundary check is asynchronous; an un-awaited one is recorded as a
  failed check on its step.
- **Say when the browser is meant to be someone else**: `h.signedInAs(user, reason)` before the
  next boundary. The switch is listed in `INDEX.md`; an unannounced one is rejected.
- **Say when it is meant to be signed out**: `h.signedOut(reason)`. Once a run has signed in, a
  boundary that finds no session, or a page off the app, is rejected — losing the session is one
  way to hide a result obtained as someone else. Before the first sign-in both are accepted.
- **`page.request` always sends the run's own user.** The context's `httpCredentials` use
  `send: 'always'`, which replaces an explicit `Authorization` on the request. A second API
  identity needs its own `request.newContext()` or Node `fetch`.
- **`h.login()` clears cookies** before it signs in, so a guest session cannot be adopted.

Its controls:

```bash
npm run beta:identity-guard-selftest     # offline: the judgement and the step wiring
APP_URL=… npm run beta:identity-guard-controls   # live, needs a guest-enabled Nuxeo
```

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

Every gate in `ALL_GATES` (26 today — an unknown `--gates` id prints the current
list), cheapest first, stopping at the first failure and printing only its output
tail: `node`, the `lockfile` and `dependency-tree` pairs, `supply-chain`,
`code-scanning`, the guardrails and sanitizer pairs, `assertions`, then affected
`lint`, `test`, `build`, `typecheck`, then `spec-types`, `bundle` and the packaging
and drift gates. [Dev Harness & Gates](../../documentation/30-engineering/08-dev-harness-and-gates.md)
has the table. That ordering is deliberate — a lint error usually explains the test
failure that would follow, and running the full set on a known-broken tree wastes
minutes per iteration.

`dependency-tree` is **blocking** since the ADF removal (NXSAT-638) set `BLOCKING = true`
in `dependency-tree.mjs`: any adf-hx, adf-core, adf-extensions, js-api or hxcs-js-client
finding fails it. Until then it was report-only and passed while listing them.

Reports land in `$EVIDENCE_ROOT/beta/gates/<timestamp>-<phase>.json`.

Three further checks are **not** in the pipeline, because they need something the
pipeline cannot assume — a measurement run, or evidence that lives outside the repo:

| Command                 | Checks                                          | Why it is separate                                                          |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `npm run beta:coverage` | no project lost coverage; `FLOORS` met          | needs a `--coverage` run first; CI runs it after Sonar's tests              |
| `npm run beta:state`    | every "complete" phase cites a passing manifest | evidence lives outside the tree, so this is local-only and cannot run in CI |
| `npm run beta:backend`  | the Nuxeo stack is up and serving               | starts containers; a side effect a gate should not have                     |

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
npm run beta:coverage -- --update-baseline   # lock in a rise
```

`nuxeo-ui` is excluded and says so on every run: its Karma builder takes
`--code-coverage`, not `--coverage.enabled`, and errors on the latter.

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
