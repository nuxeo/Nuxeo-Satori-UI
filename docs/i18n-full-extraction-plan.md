# Full i18n extraction — plan for review

**Status: approved 19 Sep 2026. In progress.**

| Decision                     | Answer                                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 locale completeness       | **A** — English complete; `fr`/`de` partial with English fallback; parity **warns** on missing keys, still **fails** on extra ones.                                                                 |
| D2 catalogue layout          | **A** — single app catalogue, per-feature namespaces; `libs/platform` gets its own when it needs one.                                                                                               |
| D3 translator context        | **A** — codemod generates what it can derive; ambiguous strings hand-written; the split is reported, not averaged. Hand-written set done 29 Sep 2026, and product-name and acronym notes are gated. |
| D4 inline templates          | **Yes** — extracted to `.html` first, as slice 0.                                                                                                                                                   |
| D5 imperative `.ts` strings  | **Done 29 Sep 2026 (slice 10, NXSAT-284).** 160 new keys; plurals as `-one`/`-many` pairs, no ICU compiler. See `docs/i18n-status.md`.                                                              |
| D6 delivery                  | One PR per project.                                                                                                                                                                                 |
| `apps/nuxeo-satori-template` | **Deferred.** 105 strings. Slice 11, unstarted.                                                                                                                                                     |

**Known incompleteness, as of 29 Sep 2026:** slices 10 and 12 are done — the imperative strings
are in the catalogue, and `checkNoHardcodedUiText` and `checkNoHardcodedDescriptorText` are both
repo-wide. The one deferred area left is `apps/nuxeo-satori-template` (slice 11, roughly 105
strings), which the guardrails exempt explicitly — an exemption is a debt marker, not a pass —
along with the sample extension and `libs/core`, which ship nothing. What stays hard-coded on
purpose elsewhere is listed, with reasons, in `docs/i18n-status.md`.

Goal, stated the way it was asked for: **every user-facing string in the application resolves
through the translation service.** Tables, titles, columns, dialogs, menus, toasts, error
messages — not a slice.

This supersedes the slice-by-slice approach in `docs/i18n-localization-plan.md` for NXSAT-284.
Read `docs/i18n-status.md` for where things stand today.

---

## The real total, measured

Earlier figures were partial. Every number below comes from a script run against the tree today.

| Category                                                                                 |         Count | Counted before? |
| ---------------------------------------------------------------------------------------- | ------------: | --------------- |
| Template strings in `.html`                                                              |          1350 | yes             |
| Descriptor strings (`label`/`placeholder`/`ariaLabel`/`tooltip` in `.ts`)                | 242 remaining | only just       |
| **Imperative strings in `.ts`** — snackbars, dialog data, error signals, thrown messages |       **192** | **no**          |
| **Strings inside inline `template:` blocks**                                             |      **~116** | **no**          |
| **Total**                                                                                |    **≈ 1900** |                 |

The imperative breakdown: 85 snackbar calls, 68 dialog-data properties (`title`, `message`,
`confirmLabel`), 28 error signals, 11 thrown `Error` messages. Concentrated in `browse` (36),
`administration` (31), `document-detail` (21) and `trash` (20).

**Twenty components have inline `template:` blocks**, which also violates the standing
`templateUrl` convention in `CLAUDE.md`. They are mostly dialogs, which is exactly where the
user-facing prose lives.

---

## What I need you to decide

Six things. The rest I can just do.

### D1 — French and German content: how complete?

This is the big one, and it is a cost question, not a technical one.

`checkTranslationCatalogues` used to require **exact key parity** across locales, which would have
meant 1900 French and 1900 German values for 1900 extracted strings — **3800 translated strings
that I would be inventing**. That is no longer the rule and the cost is gone with it: a missing key
warns, because `setFallbackLang('en')` renders English for it, and a Crowdin pull fills every
unapproved string with its English source (D8d). The concern below still stands for who OWNS the content. I have said repeatedly that Crowdin and the translation crew own
non-English content; generating 3800 machine translations and committing them contradicts that,
and it would look like finished localisation when it is not.

| Option                                                    | What ships                                                                                                                                                                                                                                                           | Cost                                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **A — English complete, `fr`/`de` partial (recommended)** | Every string keyed and in `en.json`. `fr`/`de` keep today's 59 keys plus anything high-visibility. Missing keys fall back to English, which already works — `setFallbackLang('en')`. Parity check relaxed to **warn** on missing keys, still **fail** on extra ones. | Low. Honest. Crowdin fills the rest.                                                                       |
| **B — All three locales complete**                        | 1900 × 3 values, `fr`/`de` machine-generated by me.                                                                                                                                                                                                                  | High, and the output is not translation-crew quality. A French demo would look complete and be unreviewed. |
| **C — English complete, drop `fr`/`de` until Crowdin**    | Only `en.json`. Delete the other two.                                                                                                                                                                                                                                | Cheapest, but loses the working locale-switch demo.                                                        |

**I recommend A.** It gets you the thing you asked for — every label translatable — without
pretending the translation exists.

### D2 — One catalogue or one per library?

| Option                                     |                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — single app catalogue (recommended)** | Everything in `apps/nuxeo-ui/public/i18n/en.json`, namespaced per feature. Simple, one Crowdin file, ships today.                                                                                      |
| **B — per-library catalogues**             | `libs/features/browse/i18n/en.json` etc., merged by the loader (which already supports N folders). Correct for `libs/platform`, which is **published** and whose strings must travel with the package. |

**Recommended: A now, B for `libs/platform` only.** Feature libraries are lazy-loaded into our
app and never published, so their strings can live in the app catalogue. `libs/platform` is the
one that genuinely needs its own.

### D3 — Translator context for ~1900 strings

INFO-144 requires context on every string, and `checkTranslationContext` enforces key parity with
`en.context.json`. Auto-generating 1900 entries that say "Label in browse.html" would satisfy the
gate and defeat its purpose — the exact "registered but dead" pattern the repo warns about.

| Option                                                                        |                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — generated skeleton + hand-written for ambiguous strings (recommended)** | The codemod emits real context it can derive: file, component, element, attribute role, and whether it is an accessible name. Then I hand-write the ones that actually need judgement — single words that could be noun or verb, acronyms, product names. Roughly 150–250 of the 1900. |
| **B — hand-write all 1900**                                                   | Not feasible in reasonable time, and most would be filler.                                                                                                                                                                                                                             |
| **C — relax the context gate to the core slice**                              | Cheapest; weakens a gate I just added.                                                                                                                                                                                                                                                 |

**Recommended: A**, and I will report how many were hand-written versus generated rather than
quoting one number that hides the split.

### D4 — Inline templates: extract to `.html` first?

Twenty components hold their markup in `template:` strings, against the repo's own
`templateUrl` convention. They are dialogs, so they are dense with prose.

**Recommended: yes, extract them to `.html` as a separate first commit.** It is mechanical, it
fixes a standing convention violation, and it means the codemod has one code path instead of two.
It also makes those 116 strings visible to the existing template guardrail.

### D5 — Do toasts and error messages count?

The 192 imperative strings are the ones users read when something goes wrong, which is when
wording matters most. They need `TranslateService.instant()` or `translate()` rather than a pipe,
and some are composed from variables — those need ICU parameters, not concatenation.

**Recommended: yes, include them**, but as the last slice, because a few will need
`ngx-translate-messageformat-compiler` for plurals and that is a dependency decision.

### D6 — How do you want it delivered?

| Option                                   |                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| **A — one PR per project (recommended)** | ~16 PRs, each reviewable, each independently green. Slower to merge, actually reviewable. |
| **B — one PR**                           | ~1900 changes across 150 files. It will be approved without being read.                   |
| **C — one PR per layer**                 | Three or four PRs: app, features, shared, descriptors.                                    |

---

## How the codemod will work

`tools/i18n/extract.mjs`, run per project, reviewed as a diff, gated before the next one.

**Key naming.** Deterministic from location and content, so re-running is idempotent and two
people get the same key:

```
<project-namespace>.<component>.<slug>

browse.column-settings.reset
document-detail.publish-dialog.title
shared-ui.confirm-dialog.cancel
```

Slug from the English text, kebab-cased, truncated, de-duplicated with a numeric suffix. Identical
text within one component reuses one key; identical text across components does **not** — INFO-144
forbids sharing a string across different concepts, and the codemod cannot tell concepts apart.

**The safety rule, enforced by the tool.** The English catalogue value is **byte-identical** to
the literal it replaces. This is what keeps the rendered DOM unchanged in English, which is what
keeps every harness and spec passing. Proven already: `phase-1-tag-styles` passes 21/21 against a
piped `aria-label`, and `phase-2-registry` passed unchanged after the nav keys landed. The tool
will assert it rather than trust it.

**What it rewrites**

| Shape                                | Becomes                                                   |
| ------------------------------------ | --------------------------------------------------------- |
| `>Some text<`                        | `>{{ 'key' \| translate }}<`                              |
| `placeholder="Text"`                 | `[placeholder]="'key' \| translate"`                      |
| `aria-label="Text"` / `title="Text"` | `[attr.aria-label]="'key' \| translate"`                  |
| `matTooltip="Text"` / `alt="Text"`   | `[matTooltip]="'key' \| translate"`                       |
| `label: 'Text'` in a descriptor      | `labelKey: 'key', label: 'Text'` (the NXSAT-284 contract) |
| `snackBar.open('Text')`              | `snackBar.open(this.translate.instant('key'))`            |

It also adds `TranslatePipe` to the `imports` array of every component it touches, and
`TranslateService` where it rewrites TypeScript.

**What it will refuse to touch**, because these are not prose: `<mat-icon>` ligatures, `class`,
`id`, `type`, `role`, `routerLink`, `svgIcon`, `data-*`, anything already interpolated or piped,
anything under two letters, CSS values, and Nuxeo property paths like `dc:title`.

**What it cannot do, and I will do by hand**

- **Composed strings.** `` `${name} has ${count} items` `` needs an ICU message, not a key. The
  tool will list them and refuse to guess.
- **Ternaries and conditional text.** `count === 1 ? 'item' : 'items'` is a plural, not two
  strings.
- **Concept-level key naming.** The tool names keys from text; a human should rename the ones
  where that reads badly.

---

## Sequencing

Each step is its own PR, each green before the next starts.

|   # | Slice                                                                                    | Strings | Notes                                                                                               |
| --: | ---------------------------------------------------------------------------------------- | ------: | --------------------------------------------------------------------------------------------------- |
|   0 | Inline `template:` → `.html`                                                             |       — | D4. Mechanical, no strings changed.                                                                 |
|   1 | The codemod itself, with its own tests                                                   |       — | Including a test that the English value is byte-identical.                                          |
|   2 | `apps/nuxeo-ui` remaining templates                                                      |    ~107 | 13 templates; shell already done.                                                                   |
|   3 | `libs/features/document-detail`                                                          |     236 | Largest.                                                                                            |
|   4 | `libs/features/administration`                                                           |     191 |                                                                                                     |
|   5 | `libs/features/browse`                                                                   |     184 |                                                                                                     |
|   6 | `libs/shared/ui`                                                                         |     116 | Shared — run the blast-radius check.                                                                |
|   7 | `libs/features/search`, `tasks`, `collections`, `trash`, `assets`, `knowledge-discovery` |     339 | Batchable.                                                                                          |
|   8 | `libs/shared/adf-hx-bridge`                                                              |      67 | Moot: the library was removed on 2026-10-14 (NXSAT-635), nothing left to extract.                   |
|   9 | Descriptors: actions, columns, tabs                                                      |     242 | Extends the `labelKey` contract from nav. Columns need a decision on adf-core's `DataColumn.title`. |
|  10 | Imperative `.ts` strings                                                                 |     192 | **Done 29 Sep 2026.** No ICU compiler: two keys per plural, chosen by `count === 1`.                |
|  11 | `apps/nuxeo-satori-template`                                                             |     105 | Separate app, separate catalogue.                                                                   |
|  12 | Flip `checkNoHardcodedUiText` and `checkNoHardcodedDescriptorText` to repo-wide          |       — | **Done 29 Sep 2026.** The descriptor flip surfaced 28 existing violations, all fixed.               |

## Verification, per slice

- `npm run beta:gate` green, including `spec-types`, which has already caught what `test` cannot.
- **English DOM unchanged**, asserted by the tool and spot-checked by re-running an evidence
  harness that selects on English text.
- The new keys appear in `en.json`, `en.context.json`, and — for accessible names — in
  `en-fallback.ts`, all enforced by the guardrails already in place.
- A French pass at the end of each slice, so regressions surface in the slice that caused them.

## Out of scope, and why

- **RTL.** DS-2277; Satori needs its own work first.
- **`LOCALE_ID` from configuration.** Locale _data_ is registered; providing `LOCALE_ID` itself
  is a separate change.
- **Pluralisation beyond the strings that force it.** Adding
  `ngx-translate-messageformat-compiler` is a dependency decision, raised at slice 10.
- **Translating `fr`/`de` to release quality.** Crowdin and the translation crew, per the
  standard.

## Honest estimate

Twelve slices, and slices 3–8 are the bulk. Each is a few hours of codemod run plus review plus
gate. The tool is what makes it tractable; hand-editing 1900 strings is where this goes wrong.

The risk worth naming: **the codemod's false negatives.** Anything it does not recognise stays
hard-coded and looks done. Slice 12 is the check on that — flipping the guardrails to repo-wide
will fail loudly on everything missed, which is why it is last and not optional.
