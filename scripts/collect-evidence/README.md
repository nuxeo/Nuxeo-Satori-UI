# Evidence Collection Scripts

Playwright-based tooling that turns a bug fix into a **story** — a narrative with assertions,
side-by-side comparisons and a captioned recording — rather than a folder of screenshots.

Everything lands in `~/Desktop/agentic-ui-evidence/<TICKET-ID>/fix/`, outside the repo.
Never commit evidence output.

## Prerequisite: Playwright (local-only)

Playwright is **not** a tracked dependency — it is deliberately kept out of
`package.json`/`package-lock.json` so it never affects the CI install. Check, then install
without touching the lock file:

```bash
node -e "require.resolve('@playwright/test')" 2>/dev/null && echo available || echo missing
npm install --no-save @playwright/test
npx playwright install chromium
```

The `expectNoA11yViolations` helper additionally needs `npm install --no-save @axe-core/playwright`.

## Quick start

```bash
# 1. Dev server running in another terminal (use the ticket workspace's port/proxy if you have one)
npx nx serve nuxeo-ui

# 2. Copy the template and edit it
cp scripts/collect-evidence/TEMPLATE.scenes.mjs scripts/collect-evidence/NXSAT-175.mjs

# 3. Capture both halves — same file, run twice, on the unfixed and fixed code
EVIDENCE_PHASE=before NUXEO_DOC_UID=<uid> npm run evidence:collect -- NXSAT-175 scripts/collect-evidence/NXSAT-175.mjs
EVIDENCE_PHASE=after  NUXEO_DOC_UID=<uid> npm run evidence:collect -- NXSAT-175 scripts/collect-evidence/NXSAT-175.mjs

# 4. Combine them into the artifacts a reviewer opens
npm run evidence:story -- NXSAT-175
```

## What you get

```
~/Desktop/agentic-ui-evidence/NXSAT-175/fix/
  STORY.md            the whole story, both halves, images inlined  ← paste into Jira
  contact-sheet.png   one image for the PR body
  diptychs/*.png      before | after, labelled, per scene
  annotated/*.png     callouts drawn from real DOM bounding boxes
  before/  after/
    STORY.md          that half's narrative, with per-scene checks
    manifest.json     scenes, checks, per-scene console/HTTP errors, environment, verdict
    chapters.vtt      video chapter markers
    *.png             raw screenshots, never annotated
    NXSAT-175-*.webm  captioned recording
```

## Writing a story

A scenes file exports `summary` and `scenes`. See `TEMPLATE.scenes.mjs` for a worked example.

```js
export const summary = 'One line for the title card';

export const scenes = [
  {
    act: 1, // 1 setup · 2 the behaviour · 3 the proof
    title: 'Open the folder',
    intent: 'What the user is trying to do — the reviewer was not in the ticket',
    criterion: 'AC-1', // from fix-bug Phase 1a
    hold: 2500, // ms held on the finished state, for the video
    async run(page, h) {
      await h.login();
      await h.goTo('/#/browse');
      await h.expectVisible('folder list renders', 'hxp-document-list');
      await h.shot('browse-list', { highlight: 'hxp-document-list' });
    },
  },
];
```

Three rules the runner enforces, so a capture cannot quietly stop proving anything:

- **All three acts must be present.** A missing act is a failed check.
- **Every scene names a `criterion`.** One without it fails.
- **Every scene must assert something.** A scene that only took screenshots fails on its own
  terms — checked per scene, not per run, because the act-structure assertions always
  contribute three checks and a whole-run count could never reach zero.

And one the report enforces across the two halves:

- **A byte-identical before/after pair fails — unless an assertion changed.** Identical images
  prove nothing on their own. When some check flipped between the halves the change is simply
  not visual (an `aria-label`, a `role`, a corrected request) and the pair is recorded as a
  stated limitation; when nothing at all distinguishes the halves, the comparison fails.

Do **not** branch on `EVIDENCE_PHASE` inside a scene — the two runs must perform identical
actions, or the comparison is illustration rather than evidence.

### Scenes file exports (besides `summary` and `scenes`)

| Export                       | When to use                                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skipHttpCredentials = true` | Public routes such as `/#/login`. Without it, Playwright `httpCredentials` hydrates `/me` and the browser is signed in before the login UI renders. Use a separate scenes file (default httpCredentials) for authenticated flows. |

## Helpers

From `scripts/beta-harness/helpers.mjs`, plus `shot()` added by the runner.

| Method                                        | Description                                                     |
| --------------------------------------------- | --------------------------------------------------------------- |
| `h.shot(name, { highlight, label })`          | Screenshot; records the highlight's box for later callouts      |
| `h.spotlight(selector, { label, dim })`       | Outline the live element **in the recording**; hidden in stills |
| `h.clearSpotlight()`                          | Remove it early; otherwise cleared at the next scene            |
| `h.check(name, condition, detail)`            | Named pass/fail assertion. Never throws                         |
| `h.expectVisible(name, selector, timeout?)`   | Assert a selector becomes visible                               |
| `h.expectText(name, selector, expected)`      | Assert a selector's text contains a substring                   |
| `h.expectNoConsoleErrors(name?, ignore?)`     | Assert nothing errored in the browser                           |
| `h.expectNoA11yViolations(name?, opts?)`      | axe scan at WCAG 2.1 AA                                         |
| `h.requirePrecondition(name, cond, detail)`   | Abort with its own verdict when the environment is wrong        |
| `h.note(text)`                                | State a limitation without inflating the check count            |
| `h.login()` · `h.goTo(route)` · `h.goToDoc()` | Navigation and auth                                             |

## Environment variables

| Variable                  | Default                         | Description                                               |
| ------------------------- | ------------------------------- | --------------------------------------------------------- |
| `APP_URL`                 | `http://localhost:4200`         | Dev server URL                                            |
| `NUXEO_USER`              | _(required — no default)_       | Login username; unset, the runner exits 2                 |
| `NUXEO_PASS`              | _(required — no default)_       | Login password; unset, the runner exits 2                 |
| `NUXEO_DOC_UID`           | _(none)_                        | Document UID for doc-specific scenes                      |
| `EVIDENCE_PHASE`          | _(none)_                        | `before` / `after` subfolder and video name               |
| `EVIDENCE_HEADLESS`       | `0`                             | `1` runs headless (no window to watch)                    |
| `EVIDENCE_SLOWMO`         | `120`                           | ms between interactions; per-scene `hold` does the pacing |
| `AGENTIC_UI_EVIDENCE_DIR` | `~/Desktop/agentic-ui-evidence` | Evidence root                                             |

## Committing a scenes file

Don't, by default. Nothing in CI runs these — no workflow references `collect-evidence` — so a
committed scenes file is code that never executes and rots as selectors drift. The durable
guarantee is the regression test, which does run on every PR; the artifacts that matter are
attached to the ticket.

Commit one only when no unit test can cover the behaviour: a visual regression, a
cross-component interaction, something only a rendered browser can assert. Say so in the PR
when you do.

## Legacy steps files

The twenty-odd `NXSAT-*.mjs` files that export a default `async (page, helpers, outDir)`
still run, and get a `STORY.md`, a manifest and console capture for free.

None of them calls an assertion, so they end on the verdict **`legacy-no-assertions`** and
exit `0`. That verdict is deliberately neither `pass` nor `fail`: the capture did what it was
written to do, but it proves nothing, so it can never be cited as evidence. Convert one to
`export const scenes` when you next touch it, and it starts counting.

## How the runner works

- Headed Chromium by default, so the team can watch the capture live
- `httpCredentials` **and** an injected session: the session satisfies the route guard so
  pages render, `httpCredentials` authenticates the XHRs behind them. Without both, `/nuxeo/api`
  calls intermittently 403 and you photograph empty states that read as component defects.
  Set `export const skipHttpCredentials = true` on the scenes file for public routes (login) so
  `/me` hydration does not sign the browser in before the form is shown. The runner also sets
  `sessionStorage.agentic_ui_signed_out` so anonymous `/me` hydration does not redirect away
  from `/#/login`. That file must stay **public-only**: `h.login()` only injects route-guard
  state (`helpers.mjs`), and without context `httpCredentials` the Nuxeo XHRs behind
  authenticated pages return 403 — use a separate scenes file (default credentials) for
  post-login captures.
- A caption banner is injected into the page so the recording is narrated, and hidden for
  every screenshot — stills stay clean, and annotation happens on a copy
- `spotlight()` outlines the element a scene is about, dims the rest and labels it, so the
  video points at the change instead of leaving the viewer to find it. Red on the `before`
  half, green on `after`, derived from `EVIDENCE_PHASE` and not overridable — the scene
  neither branches on the phase nor can contradict it. A selector that matches nothing fails
  the run. Hidden for screenshots too: the pair audit compares raw bytes
- Console errors, uncaught exceptions and every HTTP 4xx/5xx are attributed to the scene they
  occurred in, and rendered in `STORY.md`
- Scene start offsets are recorded as WebVTT chapters. They are measured from browser-context
  creation and are accurate to roughly 100ms — recording starts marginally earlier
