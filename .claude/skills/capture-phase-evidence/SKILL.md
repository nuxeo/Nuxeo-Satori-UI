---
name: capture-phase-evidence
description: Capture verified image evidence for a step or phase of agentic-ui-poc using the Playwright phase harness — write an assertion-bearing steps file, run it against the dev server, and produce a screenshot report (manifest.json plus INDEX.md with inlined images) that exits non-zero if any check fails. Use when asked to capture evidence, take before/after screenshots, prove a change works, produce artifacts for a PR or Confluence page, or record a Beta phase outcome.
---

# Capture phase evidence

Evidence exists to let a reviewer disbelieve you and be proved wrong. A folder of
screenshots does not do that; screenshots tied to assertions do.

Harness: `scripts/beta-harness/` (see its README). For single-JIRA-ticket bug
work use `npm run evidence:collect` instead — same helper contract, ticket-shaped
output.

## Prerequisites

```bash
node -e "require.resolve('@playwright/test')" 2>/dev/null && echo available || echo missing
# if missing (deliberately untracked, so CI installs stay unaffected):
npm install --no-save @playwright/test && npx playwright install chromium

export NUXEO_USER=<user> NUXEO_PASS=<password>   # required — there is no default
npm run beta:backend     # start nuxeo + nuxeo-opensearch, wait for the REST API
npx nx serve nuxeo-ui    # separate terminal, must be running
```

**The credentials have no default.** Unset, `beta:backend` and `beta:evidence` exit **2**
(precondition not met) before a browser opens — fix the environment, not the code. Only
`phase-0-no-backend` and `phase-4-platform` run without them; a new steps file that needs no
backend says so with `export const skipHttpCredentials = true`.

**Check the backend before diagnosing selector failures.** A stopped container
produces a dozen scattered "selector not visible" reds that read exactly like
broken components. `npm run beta:backend -- --check` answers it in a second, and
`EVIDENCE_ENSURE_BACKEND=1` makes the runner do it for you.

The one exception is `phase-0-no-backend`, which requires the backend to be
**down** — it proves the app degrades gracefully without one. With Nuxeo running it
correctly reports `precondition-not-met`, and that is not a failure to fix.

## 1. Write the steps file

Copy `scripts/beta-harness/steps/_template.mjs` to
`scripts/beta-harness/steps/<phase-id>.mjs`.

```js
export default async function run(page, h) {
  h.step('Document list shows the Modified By column');
  await h.login();
  await h.goTo('/#/browse-adf-hx');
  await h.expectVisible('document list rendered', 'hxp-document-list');
  await h.expectText('Modified By column present', 'hxp-document-list', 'Modified By');
  await h.screenshot('document-list-columns');

  h.step('Health');
  h.expectNoConsoleErrors();
}
```

Helpers: `step`, `screenshot`, `check`, `note`, `requirePrecondition`,
`expectVisible`, `expectText`, `expectNoConsoleErrors`, `goTo`, `goToDoc`,
`login`, `baseUrl`.

If the steps file only makes sense in a particular environment, say so in the first
step and abort rather than asserting into a mismatch:

```js
h.requirePrecondition(
  'Nuxeo is unreachable',
  probe?.status() !== 200,
  'a backend IS available — run phase-0-baseline instead',
);
```

Verdict becomes `precondition-not-met` and the exit code is **2**. That is not a
defect and not something to iterate on. A `phase-0-no-backend` run once recorded
"9 of 13 checks failed" — about auth guards and login rendering — when the single
cause was that Nuxeo happened to be up. Acting on those reds means editing a
working auth guard.

For something a run deliberately does not cover, use `h.note(text)`, never
`h.check(name, true)`. A check that cannot fail certifies nothing and inflates the
total; notes render as `_not covered:_` and stay out of the count.

## 2. Five rules that make a capture count

1. **Every step records at least one check.** The runner fails a run with zero
   checks on purpose.
2. **Assert the claim, not the pulse.** "`hxp-document-list` is visible" proves
   the app booted. "The first row is a folder and the Version column reads 1.0"
   proves the phase delivered something.
3. **Capture the failure paths too.** If the phase adds an error state, drive it
   and photograph it. Reviewers ask about those first.
4. **Finish with `expectNoConsoleErrors()`.** It catches the regressions a
   screenshot cannot show.
5. **A screenshot's name must match what it shows.** The runner hashes every shot
   and reports how many distinct images the run actually produced. In one Phase 2
   bundle, sixteen shots were ten pictures — `07-manifest-relabels-nav.png` was
   byte-identical to the default-manifest shot and showed a collapsed icon rail
   with no labels on it at all. If two shots come out identical, either change what
   is on screen before capturing, or rename the shot to what it really depicts and
   let the DOM check carry the claim.

## 3. Run

```bash
npm run beta:evidence -- <phase-id>
```

Output in `$AGENTIC_UI_EVIDENCE_DIR/beta/<phase-id>/<timestamp>/`:

- `NN-*.png` numbered by step
- `*.webm` video of the run
- `manifest.json` — steps, checks, environment, `screenshotAudit`, verdict
- `INDEX.md` — narrative report with images inlined, ready to paste into a PR

Exit code 0 means every check passed. Non-zero means the phase is not done —
treat it exactly like a failing test.

Read the **Screenshot audit** section of `INDEX.md` before quoting an image count.
It lists any shots that came out byte-identical. The run fails outright only if
_every_ shot is the same image; otherwise duplicates are reported and it is on you
to justify or fix them. `EVIDENCE_STRICT_SCREENSHOTS=1` fails on any duplicate —
use it when each step claims a distinct visual observation.

Useful variables: `EVIDENCE_HEADLESS=1` for CI-style runs, `EVIDENCE_SLOWMO=600`
to make a recording easier to follow, `NUXEO_DOC_UID` for doc-specific steps.

## 4. Report it

Give the user the `INDEX.md` path and **inline the key screenshots** in your
response using their absolute paths, so they can see the result without opening
files. Quote the verdict line verbatim.

## Common problems

| Symptom                                   | Cause                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ERR_CONNECTION_REFUSED`                  | Dev server not running.                                                                                  |
| Exit 2, "NUXEO_USER and NUXEO_PASS must…" | The credentials are not exported. There is no default; export them.                                      |
| Many scattered "selector not visible"     | Backend down before you suspect a component. `npm run beta:backend -- --check`.                          |
| Login appears to work but pages are empty | Nuxeo unreachable through the proxy; check `proxy.conf` and that Nuxeo is up.                            |
| Every check fails on selectors            | Component selectors changed. Verify with `grep -rh "selector: '" libs/shared/adf-hx-bridge/src/lib/ui/`. |
| Verdict `fail` with 0 checks              | The steps file captured screenshots but asserted nothing. Add checks.                                    |
| Screenshots blank at the top of the run   | Add a short wait after `login()`; the shell needs a beat to hydrate.                                     |
| Screenshot audit check failed             | Every shot in the run is the same image. The visual record proves nothing — fix the steps.               |

## Never

- Never commit evidence output into the repo — it lives outside the tree.
- Never hardcode credentials in a steps file; they come from the environment.
- Never present a capture from a previous run as evidence for a new change.
