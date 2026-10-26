# The walkthrough deck — how it is built

`04-walkthrough` presents the demo runbook as **paired slides: the edit, then the result.** Each
change gets a slide showing the actual code or configuration, and the next slide shows a real
screenshot of the running application afterwards.

It exists because the runbook is a script for a _live_ demo, and a live demo of a manifest edit is
fragile — a stale `localStorage` key, a missed hard reload, or a folder that renders a domain hint
instead of a table, and the beat dies in front of the audience. The pairs say the same thing from an
artifact that cannot misbehave.

---

## 1. It reuses the existing deck pipeline, and that matters

There was already a pipeline for exactly this, and the first attempt at this deck **missed it** and
rebuilt slides as native PowerPoint shapes with `python-pptx`. That produced a deck that did not look
like the others and could not use the validated palette or the type scale, because both are CSS.

The real pipeline:

```text
tools/video/decks/04-walkthrough.json      the content — slides, prose, code, speaker notes
        ↓  drawn by
tools/video/deck.html + deck.css           the 3840x2160 dark deck style, shared with 01-03
        ↓  photographed at 2x by
tools/video/export-pptx.mjs                full-bleed images + speaker notes from the JSON
        ↓
~/Desktop/agentic-ui-evidence/beta/slides/04-walkthrough.pptx
```

To change a slide, edit the JSON — never the `.pptx`.

```bash
node scripts/demo-deck/capture.mjs --out=tools/video/shots   # refresh the screenshots
node tools/video/export-pptx.mjs 04-walkthrough              # rebuild the deck
```

### What was added to the pipeline

`deck.html` had seven block types — `bars`, `stack`, `stats`, `split`, `steps`, `code`, `banner` —
and **no way to place an image**, which a "result in the UI" slide is entirely made of. Two were
added, in the file's own idiom:

| Block   | Renders                                                                |
| ------- | ---------------------------------------------------------------------- |
| `shot`  | One screenshot, optional caption. The result half of a pair.           |
| `shots` | Two side by side with `label`s — a before/after inside a single slide. |

`.shot__img` is bounded with `object-fit: contain` rather than sized freely. A code block that
overflows is handled by `fitCode()` stepping its font size down; an image cannot do that, so it
letterboxes instead. The alternative is an image that pushes the footnote off the slide — and an
overflowing block still screenshots, it just screenshots the wrong thing.

---

## 2. The screenshots are gated, not just taken

`scripts/demo-deck/capture.mjs` produces every image in the deck and **refuses to release a
misleading set**. That refusal is the point of the file.

The runbook's own Part 6 F8 records what the previous showcase capture shipped: three of ten
screenshots byte-identical, steps 8–10 photographing the repository root, so a panel captioned
"reads real Nuxeo ACLs" showed "no local permissions" — while the run reported 21 of 22 green.
Confirmed by inspection before this harness was written: three files at exactly 64,105 bytes and two
at 74,300.

| Gate               | What it stops                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0 — identity**   | Aborts if `/me` is not the expected user. A whole run as `Anonymous` passes every other gate and shows empty or error states throughout.                                       |
| **1 — dedup**      | SHA-256 every image; any two identical fail the run. This is the F8 defect exactly.                                                                                            |
| **2 — content**    | Each shot declares text that must be in the live DOM, or a `domAssert` predicate for structural claims.                                                                        |
| **3 — route**      | Asserts against the shot's **declared** route, never the one used to navigate.                                                                                                 |
| **4 — reload**     | Manifest-dependent shots do a real `page.reload()`; `withHashLocation()` makes `goto('/#/x')` same-document, so `APP_INITIALIZER` never re-runs and a stale manifest survives. |
| **5 — responses**  | Failed responses gated by URL; JS exceptions never allowlisted.                                                                                                                |
| **6 — dimensions** | One viewport, one `deviceScaleFactor`, so slides look consistent.                                                                                                              |

Gates 1–3 are falsifiable and were each **watched failing** before the output was trusted:

```bash
node scripts/demo-deck/capture.mjs --negative-control=route     # wrong URL
node scripts/demo-deck/capture.mjs --negative-control=content   # absent text
node scripts/demo-deck/capture.mjs --negative-control=dedup     # same shot twice
```

The shots are written to `tools/video/shots/`, which is **gitignored** — evidence does not travel
with a clone.

---

## 3. What the gates caught, and it was mostly me

Five problems on the way to a green run. **Four were in the harness, one was environmental, none was
in the product.** That ratio is the argument for the gates.

- **The route gate was tautological.** It compared where it landed against where it had been told to
  go — true by construction. A deliberate mis-route passed it. This is the tautological path check
  this repo has already been burned by, reproduced exactly.
- **Three false passes from incidental text.** `'Workspaces'` matched the domain-hint banner's own
  sentence while no document list existed at all. `'Components'` matched the nav entry "UI
  Components" while the shot showed the **login page**. `'Archive'` was asserted as text when the
  bulk topbar renders icon-only buttons and the label lives on `aria-label`. An assertion satisfied
  by chrome is not an assertion.
- **`.first()` matched the select-all checkbox**, selecting all five rows, so the properties panel
  correctly read "select a **single** document" and looked broken when it was not.
- **A whole run as `Anonymous`.** Seeding `sessionStorage` is not enough: this Nuxeo has anonymous
  auth enabled, `/me` answers 200 as `Anonymous`, and the app's SSO-detection path adopts that
  session, overwriting the seeded one. Browse then renders "Failed to load folder contents." because
  Anonymous genuinely cannot read the folder. **I read that as a functional regression and said so;
  it was not** — on the identical path an explicit Basic header answers 200. Gate 0 exists because of
  it.

Two facts worth keeping from that last one. The app's own defence, `clearStaleNuxeoCookieSession()`,
GETs `/nuxeo/logout` and swallows failure — and measured against this Nuxeo, that path answers **404**
without a `requestedUrl` parameter and **302** with one. The call omits it, so it very likely never
clears the session it exists to clear. And the template app authenticates through its **own** login
form; it does not share the product's session.

---

## 4. Preconditions

```bash
docker start nuxeo-opensearch && sleep 15 && docker start nuxeo   # :8080
npx nx serve nuxeo-ui                                             # :4200
npx nx serve nuxeo-satori-template --port 4310                    # :4310, --port is required
```

Run `npm run config:dev` before `nx serve`: the harness applies each shot's manifest and branding
as a `demo-deck` fragment in the dev server's `agentic-ui-config/` files and **restores** them
afterwards. The reset matters — the manifest (then a Nuxeo Note, read no longer since NXSAT-312)
was once found holding a previous run's column overrides, which would have made the baseline
slide a customised screen with a baseline caption.

---

## 5. Claims

Every factual claim on a slide traces to a row in [`demo-deck-claims.md`](demo-deck-claims.md),
which also records the Part 6 re-verification behind the runbook corrections: **nine of the fourteen
"do not demo" entries hold as written, F5, F6 and F13 were wrong and are withdrawn, F7 is right for
a different reason, F11 is unconfirmed.**
