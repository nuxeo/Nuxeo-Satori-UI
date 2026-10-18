# Writing accessibility checks — Playwright + a11y-scout against this app

Three pages, three jobs. `docs/accessibility.md` is the **standard** — which layer owns which
verdict. `a11y/docs/a11y-scout.md` is the **tool** — what a11y-scout is and how to install it. This
page is the **authoring guide**: how to point Playwright at this application and write a script
that finds an accessibility issue nobody has found yet.

Read the standard first. A check that duplicates an existing layer's verdict is a defect here,
not a contribution.

---

## 0. Where the file goes

The implementation lives entirely under `a11y/`, and nothing under `apps/` or `libs/` is
modified. That is not tidiness — it is what keeps the folder removable. Its **integration**
with the repository root is four small edits, and they are the whole list: the `a11y:scan`
line in `package.json`, a Definition-of-Done line in `AGENTS.md`, the a11y-scout layer in
`docs/accessibility.md`, and a `/a11y-reports/` entry in the root `.gitignore` — that last one
because a11y-scout writes its per-scan output to the repository root and `scanPage()`, unlike
`generateReport()`, takes no `outDir`. See `../README.md` for which of those to undo on removal.
(This section used to say nothing outside the folder was modified, which the PR's own diff
contradicted; it then said three edits, while the suite was quietly leaving a fourth.)

```
a11y/
  run.mjs                           the only entry point; suites and diagnostics are subcommands
  preflight.mjs                     refuses to scan a stack that is not there
  playwright.config.ts              testDir: './specs'
  fixtures.ts                       test object, installSession, expectSurfaceUsable,
                                    waitForScreenSettled, aiFindingsNote, REPORT_DIR
  cli.mjs                           strict argument parsing; bad arguments exit 2
  env.mjs                           resolveBaseUrl + required Nuxeo credentials, shared by the
                                    config, the preflight and every diagnostic
  session.mjs                       the injected app session, and the proof the app adopted it
  surface.mjs                       the Node-side twin of expectSurfaceUsable, the one list
                                    of this app's error-state classes, and the settle wait
  package.json  tsconfig.json  .gitignore
  specs/
    journey.screens.ts              single source: screen id -> project name, tag, report name
    surfaces.a11y.spec.ts           pages, default state
    interaction-states.a11y.spec.ts components and overlays, behind a click
    display-modes.a11y.spec.ts      dark / forced-colors / reduced-motion
    journey.a11y.spec.ts            workflows, one self-contained report per screen
  diagnostics/
    axe-differential.mjs
    reflow-probe.mjs
    route-render-check.mjs
    error-class-drift.mjs
  docs/          authoring.md (this file) · a11y-scout.md
  reports/  artifacts/              gitignored output
```

`apps/nuxeo-ui-e2e/` is the **critical-path** suite and is byte-identical to main. It needs no
`testIgnore` for us, because nothing of ours is under its `testDir`.

Three rules, and each is enforced by something rather than by goodwill:

1. **An accessibility spec goes in `a11y/specs/` and carries the `.a11y.spec.ts` suffix.**
   `testDir: './specs'` is what collects it, so a spec anywhere else simply never runs — and
   `a11y:scan` would report a green suite that silently skipped it. The suffix is redundant to
   the tooling and kept anyway, so a spec is self-describing in a stack trace and a report.
2. **Group by what the scan looks at, not by WCAG rule** — pages, states, modes, workflows. The
   reports already group by rule; a directory that did the same would answer a question you can
   already answer.
3. **A standalone diagnostic goes in `a11y/diagnostics/` and gets a subcommand in `run.mjs`.**
   The repo-wide convention is that a script has an entry point; here the entry point is the
   dispatcher rather than its own `package.json` line, so that the `package.json` part of
   removing the folder stays a single line.

### The four extension points, and what each costs

| To add                           | Edit                                                                    | Guard if you get it wrong                                                             |
| -------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A **route** to the surfaces scan | one row in `SURFACES`                                                   | the spec asserts `pagesScanned.length === SURFACES.length`                            |
| An **interaction state**         | one entry in `INTERACTION_STATES` + one `test()` using `enterState()`   | compile error on a bad id; the summary names any declared state that recorded no scan |
| A **journey screen**             | one entry in `journey.screens.ts` + one `journeyTest()` call            | compile error on a bad id; collection error on a missing test                         |
| A whole **new suite**            | a spec file + a project in the config + a `COMMANDS` entry in `run.mjs` | — (see below)                                                                         |

**`package.json` does not need touching**, and that is the guarantee worth having: `a11y:scan
-- journey` selects projects with a `journey-*` wildcard, so a new screen is picked up
without a script change, and `package.json` keeps a single line for this folder.

This table used to end "nothing else needs touching", which was wrong twice. A new suite also
needs its `COMMANDS` entry or the documented sole entry point has no subcommand for it and
`--help` never mentions it. And an interaction state used to be described as one `test()`
while the summary asserted a hardcoded total of seven, so the eighth state would scan
correctly and then fail the report for existing. Both flagged in review on PR #225; the
second is now a declared list, which is a second edit but one the compiler and the summary
both enforce.

### Why a journey screen is defined in one place

A screen's identity used to be written three times — a tag in the test title, a `grep` in the
config, and a project name — with nothing tying them together. That is a **silent** failure.
Measured, not assumed: a fifth project grepping a typo'd tag produced

```
Total: 4 tests in 1 file        exit: 0
```

Playwright reports "No tests found" only when the _whole run_ is empty. One project matching
nothing, next to projects that match, is dropped without a word — so the screen would never be
scanned and the command would stay green.

`journey.screens.ts` is now the single source for all three, and both ways of getting it wrong
are loud. Each was verified by breaking it on purpose:

```
journeyTest('logn', …)          → error TS2345: Argument of type '"logn"' is not assignable
                                   to parameter of type '"browse" | "login" | …'

id in JOURNEY_SCREENS, no test  → Error: 1 screen(s) declared in journey.screens.ts have no
                                   test here: search …                          exit: 1
```

The second throws at module scope, so it fails _every_ project rather than only the one that
was filtered out — which is the point, since the filtered-out one is exactly what nobody sees.

### Adding a new suite

A new suite is a spec file, one entry in the config's suite list, and one `COMMANDS` entry in
`run.mjs`. One project per consolidated report, because the a11y-scout accumulator is
worker-scoped — two spec files sharing a worker share a report. The `use` block is applied
once for all projects, so a new suite cannot pick up the wrong browser config by copy-paste.

This is the one extension point with no automatic guard, and it is missing two: a spec file
added without a project is simply never run, and a project added without a `COMMANDS` entry
can only be reached by typing a raw Playwright command, which defeats the point of a single
entry point. Keep suites few and named after what they scan, and the gap stays visible.

---

## 1. Pick the integration style

Three styles exist in this repository and they are deliberately different. Pick by what you are
trying to do, not by what you copied last.

| You want to                                               | Style                                           | Start from                                    |
| --------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| Find new keyboard / focus / reflow issues across surfaces | **Playwright Test runner + a11y-scout fixture** | `a11y/specs/surfaces.a11y.spec.ts`            |
| Answer one targeted question fast ("does X reproduce?")   | **Standalone Playwright library script**        | `a11y/diagnostics/axe-differential.mjs`       |
| Add a conformance case to the Beta gate                   | **Beta harness evidence step**                  | `scripts/beta-harness/steps/phase-6-a11y.mjs` |

The difference that matters: the **test runner** gives you fixtures, retries, parallelism and
the a11y-scout accumulator, at the cost of a config and a worker model you have to respect. The
**library** gives you a plain Node script you can run and reason about in one file. Neither is
better; the diagnostics in §4 exist as library scripts precisely because a 20-second answer
should not require a test runner.

## 2. The two things every script must do

Skip either and your script will produce confident, meaningless green.

### 2a. Authenticate with _both_ mechanisms

`httpCredentials` alone lets XHRs through but does not satisfy the app's route guard. The
sessionStorage session alone renders pages but leaves `/nuxeo/api` calls returning intermittent
403s. `a11y/playwright.config.ts` documents this and both are required:

```js
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  httpCredentials: { username: user, password: pass, origin: baseUrl },
});

// `networkidle`, not a fixed pause, so the app's own session hydration has very likely
// finished before the session below is written; the reload that follows is what makes the
// written session the one the app starts from.
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.evaluate(
  ({ key, value, signedOutKey }) => {
    sessionStorage.setItem(key, value);
    sessionStorage.removeItem(signedOutKey);
  },
  { key: SESSION_KEY, signedOutKey: SIGNED_OUT_KEY, value: injectedSession(user, pass) },
);
await page.reload({ waitUntil: 'networkidle' });
await requireSessionAdopted(page, user, TOOL);
```

The session shape and key come from `../session.mjs`; do not write the JSON inline. And do not
drop `requireSessionAdopted`. If the app rejects the injected session, it signs in through
`/me` instead, because `httpCredentials` answers that request. Every route then renders
normally, so without the check nothing shows that the session copy has drifted from
`AuthService`. `session.mjs` explains how adoption is proved.

In a **spec**, do not hand-roll this — the `signedIn` fixture already does it, including the
adoption check at teardown, and `fixtures.ts` rebases it onto a11y-scout's `test` so both are
available in one spec:

```ts
export const test = a11yBase.extend<{ signedIn: Page }>({
  signedIn: async ({ page }, use, testInfo) => {
    await installSession(page);
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) return;
    const problem = await sessionAdoptionProblem(page, requireNuxeoCredentials().username);
    if (problem) throw new Error(/* … */);
  },
});
```

Credentials come from `NUXEO_USER` / `NUXEO_PASS` and are **required, not defaulted**.
`requireNuxeoCredentials()` in `../env.mjs` throws when either is unset, and both the config
and `../fixtures.ts` call it, so a run fails at load rather than scanning as a guessed
identity. The diagnostics wrap it in `credentialsOrExit()` so the same failure exits 2. Do not reintroduce a `?? 'Administrator'` fallback: besides the security
rule, a default silently authenticates as the wrong user against any server that accepts it,
and nothing in the report says so. `checkNoNuxeoCredentialDefaults` in
`scripts/review-guardrails.mjs` fails the common shapes of one under `a11y/`, `scripts/` and
`tools/`; its docblock lists the shapes it does not see.

### 2b. Assert the surface rendered before you scan it

**An empty screen scans clean.** This is the single most expensive mistake in this repository's
accessibility tooling and it has landed three times: a step labelled "Login surface" that
scanned the dashboard, a "card view" step that scanned the table view, and `/#/collections`,
which has no matching route and has been counting its empty result as a pass for weeks.

**A visible host is not enough, and this guide used to stop there.** A failed load renders the
same host component with an error panel inside it, which is visible — so `toBeVisible()` on the
host passes and the scan measures the error state under the surface's name. Use
`expectSurfaceUsable()`, which adds absence of the known error classes and non-empty content:

```78:90:a11y/specs/surfaces.a11y.spec.ts
    test(`scans ${label}`, async ({ signedIn: page, a11y }) => {
      await page.goto(route, { waitUntil: 'networkidle' });

      // A surface that did not render scans clean, and a clean scan of nothing is the
      // vacuous pass this repository keeps getting caught by —
      // `scripts/beta-harness/steps/phase-6-a11y.mjs` shipped a step labelled
      // "Login surface" that actually scanned the dashboard.
      //
      // Settled first, so the error check below sees the end of the load rather than its start.
      await waitForScreenSettled(page, host, route === '/#/browse');
      // `expectSurfaceUsable` rather than a bare `toBeVisible` on the host: a failed load
      // renders the same host with an error panel, which is visible. See its own comment for
      // what it proves and what it still does not.
      await expectSurfaceUsable(page, host, label);
```

**Wait for the screen to settle, and never with a fixed pause.** `waitForScreenSettled()` waits
until nothing is loading and nothing is changing in the nav drawer or the host; diagnostics
call `screenUnsettledReason()` from `surface.mjs`, the same definition. A pause guesses, and on
this app it guesses badly: the routes are hash routes, so a `goto` to another `/#/…` is a
same-document navigation and `networkidle` resolves at once — the pause is then the only wait
there is. A scan that arrives mid-load can under-report, not just add noise; see
`docs/accessibility.md` on the loading spinner that hid a `button-name` failure.

The one fixed wait in these specs is not a readiness wait: `measureRouteChangeMotion()` in
`display-modes.a11y.spec.ts` samples animations for 900ms after a route change, because that
interval is the measurement itself. A duration that defines what is measured is fine; a
duration standing in for "the page is ready" is not.

The word doing the work there is **known**. The classes live in `a11y/surface.mjs`, they
belong to eighteen feature templates nothing in this folder owns, and the first version of
that list was missing twenty of them — including `.widget-error`, which the dashboard renders
in four places, so a dashboard whose widgets had all failed passed this check with room to
spare. `npm run a11y:scan -- drift` re-derives the list from the templates and runs before
every scan, so adding a feature with a new error class now fails loudly instead of quietly
widening the blind spot. **If you add an error state to a template, expect that check to stop
you** — classify it as a surface failure or document why it is not one.

Be clear on the remaining limit: it proves the surface rendered, is not in a known error
state, and is not an empty shell. It does **not** prove repository data arrived. Where a route-specific
success selector is known, assert that instead — `openBrowse()` in
`interaction-states.a11y.spec.ts` waits for `.browse-row, .doc-card-wrapper`, which only exist
when the folder request succeeded.

The strongest form is in `journey.a11y.spec.ts`: `captureDataRequest()` waits for the response
to the screen's **own** data request, requires it to succeed, and the test then requires an
element showing an entry from that response. That matters most where a failure has no error
class to catch — the search page and several drawer panels render a failed request as an empty
list. Where another component on the screen makes the same request, use
`captureEveryDataRequest()` instead: it requires every matching response to succeed, so the
other component's success cannot stand in for the page's failure.

Run `npm run a11y:scan -- routes` before authoring anything new — it tells you which routes currently
render and which are showing only their error state, so you do not spend an afternoon scanning a
dead one.

## 3. Style A — an a11y-scout spec

Import from `../fixtures` (`a11y/fixtures.ts`), never from `@a11y-scout/playwright` or
`apps/nuxeo-ui-e2e/src/fixtures.ts` directly; two `test` objects cannot coexist in one spec.

```ts
import { expect, test } from '../fixtures';

test('scans the upload dialog', async ({ signedIn: page, a11y }) => {
  await page.goto('/#/browse', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.locator('mat-dialog-container')).toBeVisible();

  await a11y.scanPage({ level: 'AA', failOnBlockers: false, noFocusIndicatorScreenshots: true });
});
```

### The `scanPage` options that actually matter

| Option                        | Default    | When to change it                                                                                             |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `level`                       | —          | Pin to `'AA'`. At AAA the semantic agent emits `__mock__` stubs in mock mode                                  |
| `failOnBlockers`              | **`true`** | Set `false` until findings are triaged, per the standard                                                      |
| `noFocusIndicatorScreenshots` | `false`    | Set `true`. Tier-2 pixel-diffs up to 30 clipped screenshots per page; tier-1 still reports missing indicators |
| `keyboard` / `focusChecks`    | on         | **Leave on.** Turning them off leaves a suite measuring only what phase-6 already measures                    |
| `include` / `exclude`         | —          | Scope axe to a subtree — useful for a dialog                                                                  |
| `extraWaitMs`                 | —          | Lazy widgets that `networkidle` does not catch                                                                |

The first `scanPage` call in a worker **locks** `level`, `maxCostUsd`, `aiFix` and the LLM
provider. Later calls inherit them and warn on conflict.

### The worker accumulator, and the trap in it

Findings accumulate **per worker**, not per test. That is what lets many tests produce one
report — and it is why a failing test fragments the output: Playwright discards a worker after a
failure, the dying worker auto-finalizes what it had, and a fresh worker starts empty.

The first full run demonstrated it exactly: eight surfaces, one failure at position five, three
report folders instead of one, and `pagesScanned` reading **3** while the console said seven
surfaces passed. So always finish with a coverage assertion:

```ts
test('emits the consolidated report', async ({ a11y }) => {
  const { state } = await a11y.generateReport({ reportName: 'my-scan', failOnBlockers: false });
  expect(state.meta.pagesScanned.length, 'the report must cover every surface').toBe(
    SURFACES.length,
  );
});
```

Make it a `test`, not `afterAll` — that is what lets a11y-scout attach the HTML to the Playwright
report. If that assertion fails, find the surface that failed; do not adjust the number.

## 4. Style B — a standalone diagnostic script

For targeted questions. Copy this skeleton into `a11y/diagnostics/<question>.mjs`:

```js
#!/usr/bin/env node
/** One paragraph: the question this answers, and why it needed its own script. */
import { parseCliOrExit } from '../cli.mjs';
import { resolveBaseUrl } from '../env.mjs';
import { injectedSession, SESSION_KEY, SIGNED_OUT_KEY } from '../session.mjs';
import {
  cannotMeasure,
  credentialsOrExit,
  gotoOrExit,
  launchChromium,
  requireBackend,
  requireSessionAdopted,
} from './preconditions.mjs';

const TOOL = '<question>';
// Every option it accepts, declared; anything else exits 2 before a browser is launched.
parseCliOrExit(TOOL, {});

// `resolveBaseUrl()`, never `process.env['APP_URL']` directly. It is the one resolver the
// config, the preflight and every diagnostic share; reading the variable yourself
// re-creates the split where `E2E_BASE_URL` moved the suites and left your script on
// localhost, which is the bug `env.mjs` exists to have fixed.
const baseUrl = resolveBaseUrl();
// Required, never defaulted — a fallback scans as the wrong identity and says nothing.
// `credentialsOrExit`, not `requireNuxeoCredentials()`: the latter throws, and an uncaught
// throw here exits 1, reporting a missing environment variable as a finding.
const { username: user, password: pass } = credentialsOrExit(TOOL);

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  cannotMeasure(
    TOOL,
    '@playwright/test is not installed',
    // Kept in sync with a11y/versions.mjs — see PINNED_PLAYWRIGHT_TEST.
    'npm install --no-save @playwright/test@1.63.0',
  );
}

// Every precondition below exits 2 through `preconditions.mjs`. Written inline, each of these
// was once left uncaught somewhere in this folder and exited 1 with a stack trace.
const browser = await launchChromium(chromium, TOOL);
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  httpCredentials: { username: user, password: pass, origin: baseUrl },
});
const page = await context.newPage();

try {
  // Backend precondition FIRST — an empty screen scans clean and proves nothing.
  await requireBackend(page, baseUrl, TOOL);
  await gotoOrExit(page, baseUrl, TOOL);
  // ... sign in (§2a), then for each route: navigate inside try/catch and record a failure
  // as unmeasured (not a crash), assert the host (§2b), measure ...
} finally {
  await context.close();
  await browser.close();
}
```

**Exit-code convention, and it is not arbitrary:** `0` measured, `1` the thing being guarded is
wrong, `2` could not measure. A diagnostic should return `0` even when it finds violations — one
that turns the build red is one people stop running. It returns non-zero for _findings_ only if
it is a gate. It must **always** return `2` rather than `0` when it could not measure, because a
scan that silently did not happen must never read as clean.

Then add it as a **subcommand in `../run.mjs`**, not as a script in the root `package.json`:

```js
  <name>: {
    describe: 'Diagnostic: the question it answers',
    preflight: false,
    argv: ['node', 'a11y/diagnostics/<question>.mjs'],
  },
```

The root `package.json` carries exactly one line for this folder, `a11y:scan`, so that its
part of removing the folder is one deletion rather than seven. A diagnostic added to `package.json` instead
becomes an orphaned root script the moment `a11y/` is deleted. See `../README.md`.

`preflight: false` is the default for diagnostics, on the grounds that a twenty-second answer
should not wait on a document query — but it means the script owns its own preconditions. If
it measures anything that an error state can satisfy, check the backend yourself;
`reflow-probe.mjs` does, because an error panel has perfectly measurable geometry.

## 5. Finding _new_ issues — drive state, do not just visit routes

This is the part that actually matters, and it is where nearly all undiscovered issues live.

The evidence is unambiguous. When `phase-6-a11y.mjs` widened from three surfaces to fifteen
cases, the count went from four rule classes to **seven**, with 77 violating nodes — and three
of the extra classes were only visible in states a single visit per route never reaches. A
contrast failure at 3.54:1 on `.card-type` was invisible until someone clicked "Card view".

Likewise, six of a11y-scout's eight `color-contrast` findings do not reproduce under a plain
navigate-and-wait. They are on date-range and select controls, so something opened a panel that
a bare `goto` does not.

### States nothing currently scans

Each of these is a place to point a new script:

- **Dialogs** — upload, share, permissions, collection edit, compare, note image picker
- **The upload flow** and its progress states
- **Error and empty states** — no results, no permission, backend 500
- **Loading states** — spinners had 101 unnamed instances repo-wide, found only because knowledge
  discovery happened to be rendering one at scan time
- **Expanded/collapsed** trees, filter panels, column pickers
- **Password-manager and autofill states** on the sign-in form. The form itself is covered —
  `journey.a11y.spec.ts` reaches the real signed-out page — but only in its empty, untouched
  state. Validation errors, a populated field and the browser's own autofill styling are not

**Dark mode** was on this list and should not have been: `display-modes.a11y.spec.ts` seeds the
theme, asserts both the `data-app-theme` attribute and a measured background luminance, and
scans all seven routes in it. Leaving it here would send a contributor to rebuild an owned
surface — the duplication this guide's own opening paragraph calls a defect.

The login surface used to be listed here as unreachable, on the grounds that `httpCredentials`
makes the app authenticate before the form can render. That was true of the mechanism and wrong
as a conclusion: the journey suite drops `httpCredentials` for its login project and sets the
app's `agentic_ui_signed_out` marker, and scans the real form against a live backend. Worth
remembering as a pattern — "the harness prevents it" is a statement about the harness.

### Reaching a state without lying about it

The danger is a click that silently does nothing, leaving a step labelled "card view" scanning
the table view and passing. Never use a bare `.click()` on something that might be absent:

```342:351:scripts/beta-harness/steps/phase-6-a11y.mjs
async function clickIfPresent(page, selector) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) {
    console.warn(`  phase-6-a11y: ${selector} not present; the state it opens was NOT scanned`);
    return false;
  }
  await el.click();
  await page.waitForTimeout(1600);
  return true;
}
```

Then **assert the state was reached** before scanning — `h.check('the column picker was actually
opened', columnPanel, …)`. A helper that returns `false` and a caller that ignores it is the
same vacuous pass in a different costume.

Quoted for the presence check, not for its `waitForTimeout(1600)`, which predates the rule in
section 2: in a spec here, follow the click by asserting the opened state, as `enterState()` in
`interaction-states.a11y.spec.ts` does, and wait on that.

### State survives navigation

View mode is held in a service, so it persists across `goto`. After a card-view step the
column-picker button is not rendered at all, and the next step will scan card view again while
claiming to scan the column panel. Reset explicitly — click "List view" first — rather than
assuming a fresh route means a fresh state.

## 6. Traps, each one already paid for

| Trap                          | What happens                                                                                                                                                                                    | Fix                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm install --no-save X`     | **Prunes** anything previously `--no-save`'d, silently removing Playwright                                                                                                                      | Install all packages in ONE command                                        |
| Plain `npm install <tarball>` | Writes `file:C:\Users\you\…` into the lockfile, breaking `npm ci` for everyone                                                                                                                  | Always `--no-save`                                                         |
| a11y-scout is ESM-only        | `No "exports" main defined` — Playwright transpiles specs to CJS                                                                                                                                | `a11y/package.json` sets `"type": "module"` for this folder only           |
| Hash routing                  | `goto('/#/x')` is **same-document**, so `APP_INITIALIZER` never re-runs                                                                                                                         | Use a real `page.reload()` when asserting reloaded-app behaviour           |
| Keyboard walk is slow         | Up to 150 steps per direction; browse has taken **11.1 minutes**                                                                                                                                | Per-test timeout is 900s in `a11y/playwright.config.ts`                    |
| A timed-out test              | Playwright **restarts the worker**, recreating the a11y-scout accumulator, so every surface already scanned is dropped. One browse timeout turned five successful scans into `pages scanned: 1` | Assert `pagesScanned.length`; it is the only thing that makes this visible |
| A failing test                | Fragments the worker-scoped report                                                                                                                                                              | Assert `pagesScanned.length`                                               |
| Dev proxy                     | `apps/nuxeo-ui/proxy.conf.json` is **not** hot-reloaded                                                                                                                                         | Restart `nx serve` after editing it                                        |
| Node 22+                      | A built-in `localStorage` shadows jsdom's                                                                                                                                                       | Node is pinned to 20 in `.nvmrc`                                           |

## 7. Before you commit a new check

1. **Does an existing layer already own this?** If yes, extend it instead. Duplicate verdicts are
   how the axe disagreement happened.
2. **Negative-control it.** Introduce the defect deliberately, watch the check go red, remove it.
   A check never observed to fail is not evidence — and a check that passed _while the defect was
   present_ has happened here, in the first version of phase-6's `aria-label` step.
3. **Does it assert the deliverable, or the app's pulse?** "A report was written" is a pulse.
   "The report covers all seven surfaces" is the deliverable.
4. **Is any exclusion scoped to one surface and does it cite an owner?** Never a global rule id.
5. **Update `docs/accessibility.md`** if the ownership table changed.
