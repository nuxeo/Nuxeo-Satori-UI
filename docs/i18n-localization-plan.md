# i18n and Localization Plan — NXSAT-227

**Ticket:** [NXSAT-227](https://hyland.atlassian.net/browse/NXSAT-227) — "Complete i18n string
extraction and wire adf-hx translation assets" · Epic
[NXENG-615](https://hyland.atlassian.net/browse/NXENG-615) · duplicate/related
[NXSAT-280](https://hyland.atlassian.net/browse/NXSAT-280) (identical summary — close one).

**Status:** slices S1–S5 delivered on `feature/nxsat-227a-i18n`. S6 (the Crowdin pipeline) is
built and has run end to end against the live tenant: project 160 exists, 1,972 English strings
and 1,972 translator-context entries are uploaded, and the pull opened a real pull request. What
remains is Crowdin-side rather than a pipeline gap — **Crowdin holds almost no approved
translations**: 8 strings each in French and German as of 29 September 2026, none in the other
seven target languages. **That changed by 5 October 2026**: Crowdin Status showed `de`, `es`, `fr`,
`ja`, `nl`, `th` and `zh-CN` at 99% approved, `pt` at 88% and `pl` at 2% (99% translated), and
NXSAT-293 ships `ja`, `nl`, `th` and `zh` beside `fr` and `de`. `es` is held back on one string —
see D8e. **Changed again on 30 October 2026**: the target set was aligned to Nuxeo Web UI's ten,
dropping `th` and `zh` and adding `ar`, `he`, `it`, `es` and `sv`. Five ship (`en fr de ja nl`);
the additions are registered, and `es` is requested from Crowdin; `ar`, `he`, `it` and `sv` are
Crowdin targets held out of the pull list until they have approvals — `D8e-webui`.
Project membership is resolved (Manager access on
28 September) and the translation team has confirmed it can begin (INTERN-1346, 28 September).
Until 5 October that was separate from what the repository shipped: `fr.json` and `de.json`
carried 151 hand-written strings written before Crowdin existed, which is why D8d's data loss
mattered, and D8f's one-time seeding step to preserve them was never run. NXSAT-293 replaced both
catalogues with Crowdin output once approval had caught up, and none of the 75 translated keys
`main` held per file reverted to English, so that risk has passed. Plus the two gaps D8d
and D8e record. Conformance against the enterprise standard, clause by clause including what is
still owed, is **`D8-standard`**. The GA extraction is
[NXSAT-284](https://hyland.atlassian.net/browse/NXSAT-284).

> **Looking for where we stand rather than what we decided?** Read
> [`docs/i18n-status.md`](i18n-status.md). It carries the measured coverage numbers, what existed
> before, what shipped, and the ordered next steps. This file is the plan and the reasoning behind
> each decision; that one is the position. They are separate because a plan that carries its own
> progress report goes stale silently and gets believed anyway.

### What shipped, 16 September 2026

| Slice | Delivered                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1    | The `DOCUMENT_TREE.TOGGLE_ARIA-LABEL` alias (W13) and the missing `settings.themes.search` fallback. Its catalogue value was literally `"Search (placeholder)"`, shipping as a real accessible name.                                                                                                                                                                                                                                                                      |
| S2    | `checkTranslationCatalogues` and `checkAccessibleNameFallbacks`.                                                                                                                                                                                                                                                                                                                                                                                                          |
| S3    | `checkNoHardcodedUiText`, plus `review-guardrails.selftest.mjs`, registered as gate `guardrails-selftest`, an npm script, in `review:preflight` and in CI. It is the first negative-control suite any guardrail in this repository has had; eleven shipped before it with none. **No count here on purpose** — `npm run review:guardrails-selftest` prints its own totals, and this line carried a stale one through three rounds (58, then 71, while the suite held 78). |
| S3a   | `checkTranslationContext`, and `checkAngularDevAssets` extended to compare `ignore`.                                                                                                                                                                                                                                                                                                                                                                                      |
| S4    | 48 occurrences extracted across `apps/nuxeo-ui`, with `en.context.json`.                                                                                                                                                                                                                                                                                                                                                                                                  |
| S5    | `fr` and `de` catalogues at full key parity, and `steps/nxsat-227-i18n.mjs`. **No total here** — `npm run beta:evidence -- nxsat-227-i18n` prints one and writes it to `manifest.json`, and this cell previously said 29/29, a figure matching neither the attached report nor the steps file. Read it from the run.                                                                                                                                                      |
| S5a   | `W14` — adf-core no longer resets the language on adf-hx surfaces — plus Angular locale data for `fr`/`de`, `checkLocaleDataRegistered`, and a formatting-locale guard so an unshipped locale degrades instead of throwing. All three found by running the application, not by the gates.                                                                                                                                                                                 |

**Two defects in this work were found by writing its own controls, not by review:** an unguarded
`JSON.parse` that crashed the guardrail script and discarded every other guardrail's
diagnostics, and a parity branch that reported "no en.json" for a file that was present but
unparseable. A third — a fragile `.first()` selector that read an adf-hx input instead of the
header search box — was found because the instrumentation separated "the swap never reached the
browser" from "the locale did not apply".

**Read the French and German screenshots as proof of the mechanism, not of a localised
application.** The header search is French; the nav labels, column headers and adf-hx toolbar are
still English, because those strings live in `libs/` and are NXSAT-284. The capture says so in
its own notes.

The `fr` and `de` catalogues are developer-supplied bootstrap translations, **not
translation-crew output**. Crowdin is the source of truth for every non-English locale once the
project exists; these prove the mechanism, not the wording.

This plan covers the five phases requested: requirement, design, build, test, and
maintenance. It is written against the repository as it stands on `main` at `829feae`, and
against the Hyland localization standard rather than a locally invented one.

---

## Sources of truth this plan is built on

| Source                                                                                                                                 | What it settles                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Guidelines for Localization Management with Crowdin Translations Tool](https://hyland.atlassian.net/wiki/spaces/HXP/pages/1891566724) | The enterprise standard. Status **Accepted**, approved 12 Sep 2024, RFC 2119 language. This is normative, not advisory.                                                                                                                                                                                                 |
| **INFO-144 — Internationalization Strategy for software** (RFC, RFC 2119)                                                              | The string-level requirements: translator context REQUIRED on every string, acronyms expanded, no strings built by concatenation, a typo fix must not discard translations, and strings not shared across different concepts. Its _Weblate_ mandate is scoped to BitBucket and does not reach this repository — see D0. |
| [Localization with Crowdin Translations Tool: Technical Usage Guide](https://hyland.atlassian.net/wiki/spaces/HXP/pages/1891600892)    | `crowdin.yml` shape, CLI bootstrap, the two GitHub Actions, signed-commit setup, token scopes.                                                                                                                                                                                                                          |
| [Translations for Web UI and Elements](https://hyland.atlassian.net/wiki/spaces/NuxEng/pages/2232484224)                               | How Nuxeo Web UI does it today. **Not authority** — it is an older implementation on the public tenant and is not compliant with the Guidelines above. Useful only as a measured comparison; where it differs from the standard, the standard wins. See `D8-standard`.                                                  |
| [Crowdin Integration (i18n)](https://hyland.atlassian.net/wiki/spaces/NuxEng/pages/3148546309)                                         | The Nuxeo platform (Java) side. **Contains a live Crowdin API token in plaintext — see the security note below.**                                                                                                                                                                                                       |
| [The State of Localization in Satori / CIC](https://hyland.atlassian.net/wiki/spaces/HDF/pages/4194568689)                             | The RTL maturity spectrum and the honest position: Satori is a foundation, not a switch. Tracked as [DS-2277](https://hyland.atlassian.net/browse/DS-2277).                                                                                                                                                             |
| [Satori Components Consumers](https://hyland.atlassian.net/wiki/spaces/HDF/pages/3803285020)                                           | `ngx-translate` 16/17 is the de-facto provider across the CIC portfolio. We are already aligned.                                                                                                                                                                                                                        |
| `docs/adf-hx-beta-plan.md` (plan of record)                                                                                            | The 21 Aug 2026 decision that descopes translations from Beta.                                                                                                                                                                                                                                                          |
| `AGENTS/11-beta-program.md` §3                                                                                                         | Verified facts, including four about `AppTranslateLoader` that this ticket must not re-litigate.                                                                                                                                                                                                                        |

There is **no** Hyland-wide standard for the _internationalization_ half — locale detection,
date formats, RTL, pluralisation. The Crowdin RFC says so explicitly in its Scope section:
it governs localization (managing keys and translations) and assumes the app already has i18n
machinery. So the framework choice is ours, and `ngx-translate` is already the portfolio norm.

---

## Phase 1 — Requirement

### What the ticket claims, checked against the code

The ticket was carved out of the closed NXENG-638 and two of its three premises have since
gone stale. Measured on `main` at `829feae`:

| Ticket claim                                                                 | Verified?                        | Evidence                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `en.json` holds 16 keys in three namespaces                                  | **True**                         | `apps/nuxeo-ui/public/i18n/en.json` — `app`, `browse`, `settings`.                                                                                                                                                     |
| `\| translate` appears 7 times across ~90 templates                          | **True**                         | 7 call sites in 3 templates; 92 templates, 89 tracked.                                                                                                                                                                 |
| "Upstream adf-hx translations are not wired"                                 | **Stale — already done**         | `SEEDED_FOLDERS` in `apps/nuxeo-ui/src/app/i18n/app-translate-loader.ts:62-93` seeds `adf-core`, both adf-hx catalogues and `@hylandsoftware/satori-ui`. The `bundle` gate asserts all three ship. Phase 3 fixed this. |
| The raw `DOCUMENT_TREE.TOGGLE_ARIA-LABEL` key is a symptom of unwired assets | **False — different root cause** | See below.                                                                                                                                                                                                             |

### The accessible-name defect has a different root cause than the ticket states

The key **exists** in the shipped catalogue:

```json
"DOCUMENT_TREE": { "TOGGLE_ARIA-LABEL": "Toggle" }
```

`node_modules/@alfresco/adf-hx-content-services/ui/assets/adf-enterprise-adf-hx-content-services-ui/i18n/en.json`

But upstream's own template asks for a different key — there is a **trailing space inside the
key literal**:

```html
[attr.aria-label]="('DOCUMENT_TREE.TOGGLE_ARIA-LABEL ' | translate) + node.name"
```

`HxpDocumentTreeComponent`, compiled into
`node_modules/@alfresco/adf-hx-content-services/fesm2022/alfresco-adf-hx-content-services-ui.mjs`.

So the lookup misses a catalogue entry that is present, ngx-translate falls through to its key
passthrough. The button's accessible name became `DOCUMENT_TREE.TOGGLE_ARIA-LABEL undefined` —
`undefined`, not the node name, because upstream appends `node.name` and its node wrapper has no
such property. **No amount of asset wiring fixes this.** It is an upstream typo in the same class as
finding 4.6 in `docs/adf-hx-upstream-findings.md`, and it renders on every surface because the
tree is the app shell's nav drawer (`libs/shared/adf-hx-bridge/src/lib/ui/hxp-browse-nav-drawer/`).

This matters for sizing, but **not as much as this paragraph originally claimed.** It said the
visible defect "needs a one-line Layer 0 entry, not an integration". The one-line entry — the W13
alias — stops the raw key and does not produce a usable name, because there is a **third** defect
in the same binding: upstream appends `node.name`, and `node` is a wrapper carrying
`node.document`, `node.isLoading` and `node.isSelectable`, with no `name` on it at all. Measured
with the alias in place and nothing else:

```
tree aria-labels: ["Toggleundefined", "Toggleundefined"]
```

So the accessible name needs the alias **and** W15, a directive that derives the name from the row
the tree already renders — see `docs/adf-hx-workarounds.md` and
`hxp-document-tree-toggle-name.directive.ts`. Still not an integration, and still small; but a
one-line catalogue entry was never going to be the whole of it, and sizing the slice from this
sentence would have under-read it.

The rest holds: the ticket's headline deliverable "wire adf-hx translation assets" is already
delivered, and no amount of asset wiring touches any of the three defects.

### The scope question the ticket asks is already answered

The ticket's own closing note says: _"Worth confirming whether full i18n is a Beta requirement
or a GA one before committing to it."_ It was confirmed, and recorded in the plan of record:

> **Translations are descoped from Beta.** No further i18n extraction before Beta. The
> _mechanism_ stays, because the manifest's `labels` map layers over the catalogue and that is
> a Layer 0 capability — a customer relabels without a rebuild. Extraction beyond the slice
> chrome moves to GA.
>
> — `docs/adf-hx-beta-plan.md`, "Decisions taken 21 August 2026"

**Recommendation: split NXSAT-227 along that line rather than run it as one story.** As
written it is a single ticket whose acceptance criteria straddle a scope boundary that has
already been decided, and it will read 80% done for weeks while the remaining 20% is the bulk.
That is exactly the failure mode that caused NXENG-638 to be split in the first place.

### Proposed split

| Ticket                | Scope                                                                                                                                                                 | Why here                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **NXSAT-227a — Beta** | Fix the accessible-name defect; add the raw-key guardrail and its selftest; prove one non-English locale end to end; stand up Crowdin against the existing catalogue. | Closes a WCAG defect, stops regression, and puts the localization pipeline in place while the key count is small enough that the Crowdin bootstrap is cheap. |
| **NXSAT-227b — GA**   | Extract the ~750 hard-coded strings and ~400 literal `aria-label`/`title` attributes across 13 projects.                                                              | Explicitly moved to GA by the 21 Aug decision. Needs the guardrail from 227a to not regress behind it.                                                       |

If leadership overturns the 21 Aug decision and wants full i18n for Beta, that is a scope
change to the Beta plan and should be recorded there, not absorbed silently into this ticket.

### Acceptance criteria, restated as testable statements

Tagged `[ticket]` for verbatim, `[derived]` where the ticket implies but does not state, and
`[decision]` where a human must choose before build starts.

**227a (Beta):**

| #   | Criterion                                                                                                                                                                                                                                                           | Source                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A1  | No control in the running application has an accessible name matching `/^[A-Z][A-Z0-9_]*\.[A-Z0-9_.-]+$/`, asserted over `aria-label`, `title` and rendered text on all eight routes.                                                                               | `[ticket]` AC 2, made measurable                                                           |
| A2  | `apps/nuxeo-ui/public/i18n/en.json` and `en-fallback.ts` blank no key that upstream uses as an accessible name.                                                                                                                                                     | `[derived]` — extends the existing `phase-6-a11y.mjs` check from `sat.*` to all namespaces |
| A3  | A new hard-coded user-facing string added to the core slice fails `npm run review:guardrails`, demonstrated by a deliberate red run.                                                                                                                                | `[ticket]` AC 3                                                                            |
| A4  | Setting Layer 0 `defaultLanguage: 'fr'` and reloading renders French in the shell chrome, with a screenshot and a passing check.                                                                                                                                    | `[ticket]` AC 4                                                                            |
| A5  | `crowdin.yml` exists, a Crowdin project is created for this repository, and push/pull workflows run green with the source catalogue uploaded.                                                                                                                       | `[derived]` — required by the HXP standard, which the ticket does not mention at all       |
| A6  | Translation catalogues are validated by a unit test: parseable, UTF-8, no empty string values, and no key `en.json` lacks. A key en.json HAS and a locale lacks only warns, because a key added since the last pull renders English through the fallback — see D8d. | HXP standard, "Basic Unit Testing Setup" (SHOULD)                                          |

**227b (GA):**

| #   | Criterion                                                                                                                                                              | Source          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| B1  | Every user-facing string in browse, search, document detail and shell resolves through the translation service; no hard-coded display text remains in those templates. | `[ticket]` AC 1 |
| B2  | The guardrail from A3 runs repo-wide over the core slice rather than diff-scoped.                                                                                      | `[derived]`     |
| B3  | Target locale set agreed and translated to the release bar.                                                                                                            | `[decision]`    |

### Decisions

Q1 and Q2 were settled on 16 September 2026, and Q4 on 20 September — it does not block slice S6;
the table below records the measurement. **Q3 alone remains open.** This paragraph said "Q3 and Q4
remain open: Q4 blocks slice S6" while the row immediately beneath it recorded Q4 as answered and
non-blocking, which is the plan of record contradicting itself one line apart.
Q3 blocks any RTL commitment.

| ID  | Question                                    | Answer                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Is full extraction Beta or GA?              | **GA — decided. Split the ticket** into 227a (Beta) and a new GA ticket, per the table above. This confirms the 21 Aug decision rather than overturning it.                                                                                                                                                                                                                      |
| Q2  | Which target locales?                       | **`fr` and `de` — decided.** Both are covered by every upstream catalogue we seed (adf-core, both adf-hx bundles, satori-ui), so a locale switch exercises the whole stack rather than our own file alone. Web UI ships 16; matching that at Beta is not credible.                                                                                                               |
| Q3  | Is RTL in scope?                            | **Open.** Recommendation: no, for neither Beta nor the GA extraction. Track against [DS-2277](https://hyland.atlassian.net/browse/DS-2277) and target the "good enough" level from the Satori spectrum. Arabic and Hebrew are Web UI release-blocking locales, so this will return.                                                                                              |
| Q4  | Who reviews the Crowdin PR when it appears? | **Answered 20 Sep 2026 — it does not block S6.** The question was posed as "who owns the _daily_ PR", on the premise that an unowned one rots. Both halves were wrong; D8b below records the measurement, and the query to reproduce it, because the first version of that table stated four counts that no query produced. It is a release-checklist line, not a standing role. |

---

## Phase 2 — Design

### D0 — Crowdin governs, not Weblate, and the reason needs recording

Two Hyland RFCs name different translation tools, so this will be re-litigated unless the
resolution is written down.

INFO-144 says _"All new development in BitBucket MUST use Weblate"_. That mandate is scoped to
BitBucket; this repository is `github.com/nuxeo/Nuxeo-Satori-UI`. The Hyland Experience side has
its own Accepted RFC naming Crowdin, the whole Nuxeo estate is already on Crowdin, and Weblate is
being retired over there — Hyland Mobile ran a "Weblate-to-Crowdin Migration" and Clinician
Window's Weblate page is titled "Deprecated". INFO-144 reads as the OnBase/LRM/TFS lineage
throughout.

**So: Crowdin for the tool, INFO-144 for the string-level rules.** The two do not otherwise
conflict, with one exception below.

### D0a — One documented deviation from INFO-144, not compliance

INFO-144 requires **both** that a typo fix _"MUST NOT remove previous translations"_ and that
_"Any change made to the source string MUST identify the associated translation as requiring a
review"_.

The HXP standard's chosen `update_option: update_without_changes` satisfies the first and **not**
the second — its own pros/cons table gives the con as "translations team cannot easily detect if
translations need to be checked again". The alternative, `update_as_unapproved`, satisfies the
second and breaks the first, because translations revert to English while awaiting re-approval.

The HXP standard mitigates with a manual Crowdin "Modified Source Strings" filter plus a
developer convention: **never change the meaning of an existing key — change the key.** That is
defensible, and it is a deviation rather than compliance. Recorded here so a future audit finds
the reasoning instead of the gap.

### D0b — Translator context lives in a sibling file, and is gated

INFO-144: _"All available context is REQUIRED for all strings"_, and _"All acronyms or
abbreviations MUST be expanded and explained in the comment"_. Its worked examples are the
argument — "Display Manager Failure" cannot be translated without knowing whether "Display" is a
noun or a verb, and Japanese needs different words for "from" depending on whether a date range
or an email sender is meant.

Context goes in a sibling `i18n/en.context.json`, keyed identically to the catalogue. Chosen over
embedding it in the catalogue or entering it in the Crowdin UI because it then sits in version
control next to the string and survives a change of translation tool — the same argument the
Crowdin RFC makes for keeping the source of truth in the repository rather than the vendor.

`checkTranslationContext` enforces key parity in both directions: a new string cannot arrive
without context, and context for a deleted string cannot linger and later describe a reused key.
Whether a given sentence of context is _sufficient_ is a judgement no script can make, and the
guardrail's docstring says so rather than implying more.

The file is excluded from the build assets in every configuration, so it does not ship. That
exclusion is itself gated: `checkAngularDevAssets` now compares the `ignore` list, which it did
not before — an entry excluding a file in the base array and not in `development` read as
identical while the two configurations served different files.

### D0c — Concatenated strings are forbidden, and upstream does it

INFO-144: _"Strings MUST NOT be built from concatenated substrings or values."_ Upstream's
document tree does exactly that — `('DOCUMENT_TREE.TOGGLE_ARIA-LABEL ' | translate) + node.name`
— so even with the key resolved, no translator can reorder for a language that needs the noun
first. Our alias fixes the key; it cannot fix the word order. Both halves are finding 1.3 in
`docs/adf-hx-upstream-findings.md`, with the ask being an interpolation parameter rather than a
`+`.

### D1 — Keep `ngx-translate` and `AppTranslateLoader`; do not replace either

Already correct and already aligned with the portfolio: `@ngx-translate/core@17.0.0`,
one hoisted copy, matching the `ngx-translate 16/17` norm in
[Satori Components Consumers](https://hyland.atlassian.net/wiki/spaces/HDF/pages/3803285020).

`AGENTS/11-beta-program.md` §3 records why the loader must not be swapped for adf-core's
`TranslateLoaderService`: doing so deletes the manifest-`labels` layering, which is a shipped
Layer 0 capability, and pulling `@alfresco/adf-core` onto an import chain from `app.config.ts`
moved the initial bundle 1.71 MB → 2.86 MB. That is a verified fact. Do not re-litigate it.

The loader's existing merge order is the design, and it is already right:

```
seeded upstream folders  →  our app catalogue  →  manifest `labels`
       (lowest)                                       (highest)
```

### D2 — Follow the Hyland CIC file layout, not Web UI's

Web UI uses `i18n/messages.json` + `messages-<locale>.json` with a build-time merge script
(`scripts/merge-messages.js`) and a `crowdin-conf.yml` full of `translation_replace` locale
renames. That is a Polymer-era convention carried forward, and the Hyland standard has since
converged on something different:

```yaml
'source': '/**/**/i18n/en.json'
'translation': '/%original_path%/%locale%.%file_extension%'
```

Our repo already matches the standard's shape — `apps/nuxeo-ui/public/i18n/en.json`. **Do not
port Web UI's `messages.json` naming.** We would be adopting a locale-rename table we do not
need in order to look like a repo we are not.

What _is_ worth taking from Web UI is the process, not the file layout: the `translation` Jira
label, the pre-QA check on translation-labelled tickets, and the hard rule that
`messages-<locale>.json` equivalents are never hand-edited.

### D3 — Per-library catalogues, enabled now, populated in 227b

`libs/platform` is a **publishable package**. A customer consuming it needs its strings, and
strings that live in `apps/nuxeo-ui/public/i18n/en.json` do not ship with it. So the eventual
layout is per-library:

```
libs/platform/…/i18n/en.json
libs/features/browse/…/i18n/en.json
apps/nuxeo-ui/public/i18n/en.json
```

The good news is that **this needs no loader change**. `AppTranslateLoader` already merges N
folders and already exposes `registerProvider(name, path)`. Adding a library catalogue is an
asset glob plus a registration — the same mechanism the four upstream folders use.

**Design decision:** land 227a against the single app catalogue, and write the Crowdin glob so
that per-library catalogues are picked up automatically when 227b adds them. No migration step
later.

### D4 — Key naming: keep lowercase dotted, do not adopt SCREAMING_CASE

Our keys are lowercase dotted (`browse.details.show`); every upstream catalogue we seed uses
SCREAMING_CASE (`DOCUMENT_TREE.ROOT`, `MANAGE_VERSIONS.DIALOG.TITLE`). Keeping the two
distinguishable is worth more than consistency with upstream, for three reasons: a raw key
rendered on screen tells you immediately whose catalogue is at fault; the guardrail in D6 can
use case to tell "an untranslated upstream key leaked" from "one of ours is missing"; and
there is no collision risk when the merge is flat.

Convention, matching what is already in `en.json`:

```
<namespace>.<area>.<element>       app.nav.toggle
                                   browse.details.toggle
                                   settings.themes.apply
```

Namespace per feature library, plus `app` for the shell. Alphabetically sorted. Placeholders
use ngx-translate's `{{ }}` interpolation.

### D5 — The accessible-name fix: three options

| Option                         | Mechanism                                                                                        | Verdict                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **a. Manifest `labels` entry** | Layer 0 entry keyed on the literal `'DOCUMENT_TREE.TOGGLE_ARIA-LABEL '`, trailing space and all. | Ugly, but no rebuild, and it is precisely what the `labels` layer exists for.                                                                                                                                                                          |
| **b. Seeded-catalogue shim**   | Add the trailing-space alias to the merged folder catalogue in `app-translate-loader.ts`.        | **Recommended.** It belongs with the other adf-hx workarounds, gets a `WORKAROUND(adf-hx): W#` marker and a row in `docs/adf-hx-workarounds.md`, so the `checkAdfHxWorkaroundIds` guardrail keeps it from being orphaned when upstream fixes the typo. |
| **c. Wait for upstream**       | File the finding and live with it.                                                               | Not acceptable — it is a live WCAG 4.1.2 / 2.4.6 defect on every surface.                                                                                                                                                                              |

Take (b), and file the upstream finding alongside 4.6 in `docs/adf-hx-upstream-findings.md`
regardless of which is chosen. There has been no stable adf-hx release in twelve months, so
"upstream will fix it" is not a plan.

### D6 — The guardrail: diff-scoped first, with a selftest

The ticket asks for a gate "in the same spirit as the existing hard-coded-colour guardrail"
(`checkThemeTokens`, `scripts/review-guardrails.mjs:194-229`). Registration is trivial — a
`function checkX()` that calls `fail()`, plus a call at the bottom of the file.

Two design points the existing guardrails have already litigated:

- **Scope.** `checkThemeTokens` is diff-scoped; `checkBlobUrlLifecycle` was deliberately
  converted to repo-wide because diff-scoping permanently exempts every pre-existing
  violation, and four real leaks hid behind that. With ~750 pre-existing hard-coded strings,
  repo-wide is not tractable today. So: **diff-scoped for 227a, repo-wide over the core slice
  in 227b**, and say so in the guardrail's own docstring rather than leaving the reader to
  guess which it is.
- **Testing.** There are **no unit tests for `scripts/review-guardrails.mjs`** — not one, for
  eleven guardrails. The only mechanised negative-control precedent in the repo is
  `scripts/beta-harness/sanitizer-audit.selftest.mjs`, which is registered as its own gate
  (`sanitizer-selftest`) on the stated principle that "a gate whose evidence is optional is a
  gate on trust rather than on proof." Per `CLAUDE.md` — _"A gate is not evidence until you
  have seen it fail on purpose"_ — **ship a selftest with the guardrail**, modelled on that
  one. Three guardrails in this programme were green while the thing they guarded was broken.

Two guardrails are worth having, not one:

| Guardrail                    | Checks                                                                                                                                                                                                                                                      | Scope                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `checkNoHardcodedUiText`     | Added lines in `.html` introducing element text, `placeholder=`, `matTooltip=`, `alt=`, `aria-label=` or `title=` with a literal display string and no `\| translate`.                                                                                      | diff (227a) → core slice repo-wide (227b) |
| `checkTranslationCatalogues` | Every `i18n/*.json` parses, is UTF-8, has no empty-string values, and carries no key its sibling `en.json` lacks. Missing keys warn only (D8d). `checkCataloguesAreTranslated` covers the inverse: a catalogue at full parity whose values are all English. | repo-wide, cheap                          |

The second is what the HXP standard means by "Basic Unit Testing Setup", and it earns its
keep independently: a JSON file with a trailing comma breaks the Crowdin sync, and an
empty-string value is how the `aria-label=""` critical violation happened in the first place.

### D7 — Proving a non-English locale requires consuming `availableLanguages`

`defaultLanguage` and `availableLanguages` are both Layer 0 keys, both validated, both
unit-tested — and **`availableLanguages` is never read by anything**. Only `defaultLanguage`
is consumed, in `apps/nuxeo-ui/src/app/config/provide-app-config.ts:59`. There is no language
picker anywhere in the application.

That is exactly the "registering descriptors nothing renders" pattern `CLAUDE.md` warns about,
and it makes AC 4 ambiguous. Two ways to satisfy it:

| Option                                                     | What it proves                                                                                                                        | Cost                                                                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bootstrap override + full reload**                       | `defaultLanguage` works, which is the literal AC.                                                                                     | Low. But note `withHashLocation()` makes `goto('/#/x')` same-document, so the evidence capture **must** call `page.reload()` or `APP_INITIALIZER` never re-runs and the assertion is vacuous. |
| **Minimal language picker driven by `availableLanguages`** | Both keys work, and the config surface stops being half-dead. adf-core already ships `LanguagePickerComponent` and `LanguageService`. | Higher — a new UI surface, a new a11y surface, and a decision about where it lives in the shell.                                                                                              |

**Recommendation for 227a: the bootstrap override**, and file the picker as its own story.
AC 4 says "the Layer 0 `defaultLanguage` key does something visible", which the override
proves. Do not let a picker in through the side door of an extraction ticket.

### D8-standard — conformance with the Hyland Crowdin standard

**Start here if two documents disagree.** The authority is
[Guidelines for Localization Management with Crowdin Translations Tool](https://hyland.atlassian.net/wiki/spaces/HXP/pages/1891566724/Guidelines+for+Localization+Management+with+Crowdin+Translations+Tool)
— HXP space, status **ACCEPTED**, RFC 2119 language, four named approvers — and its companion
[Technical Usage Guide](https://hyland.atlassian.net/wiki/spaces/HXP/pages/1891600892/Localization+with+Crowdin+Translations+Tool+Technical+Usage+Guide).
**Where `nuxeo-web-ui` differs from this table, the standard wins**: it is an older
implementation on the public tenant and is not compliant with these Guidelines. It appears below
and elsewhere in this plan only as a measurement.

**The statuses**, and the distinctions matter:

| Status                   | Means                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **CONFORMS**             | We do what the clause says.                                                                                            |
| **EXCEEDS**              | We do more than the clause asks.                                                                                       |
| **DEVIATES-JUSTIFIED**   | We do something else on purpose, with the reason stated in the row.                                                    |
| **DEVIATES**             | We do not comply and have no justification — an open gap, not a decision.                                              |
| **OWNER-ACTION-PENDING** | Nothing in this repository can close it. It needs a person with a credential, an account, or an answer we do not have. |

**A row may carry two of these**, because compliance and ownership are different axes. `DEVIATES` +
`OWNER-ACTION-PENDING` is a gap someone else has to close; `CONFORMS` + `DEVIATES-JUSTIFIED` is a
clause we satisfy while deliberately declining an adjacent recommendation. Both combinations appear
below and neither is a defect in the taxonomy — but the taxonomy said "three statuses" while the
table used five and combined them, which was.

**Four rows are owner actions**: seeding, revoking the setup token, the service-account commit
identity, and confirming the project-level export settings. Confirming the proof-reading workflow
was the fifth and closed on 30 October (INTERN-1363). They are listed rather than omitted so the
pipeline is not read as finished.

| Requirement (quoted)                                                                                                                                                                                                                                                                                                                                           | Our implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One project per repository, named after the repository, requested on INTERN.                                                                                                                                                                                                                                                                                   | Project **160**, `agentic-ui-poc`, requested via [INTERN-1346](https://hyland.atlassian.net/browse/INTERN-1346).                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **CONFORMS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Configuration file at the repository root.                                                                                                                                                                                                                                                                                                                     | `crowdin-conf.yml` at the root. The name is ours — the standard does not mandate one — and the workflows pass `config:` explicitly so the file in use is visible.                                                                                                                                                                                                                                                                                                                                                                                                       | **CONFORMS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Source strings **MUST** be uploaded on every change merged to main.                                                                                                                                                                                                                                                                                            | `crowdin-push.yaml`, `on: push: branches: [main]`, filtered to the source catalogue and context globs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **CONFORMS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A daily scheduled pull opening a pull request is **RECOMMENDED**; on-demand **SHOULD** be possible.                                                                                                                                                                                                                                                            | `crowdin-pull.yaml`, `cron: '0 0 * * *'` plus `workflow_dispatch`, `create_pull_request: true`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **CONFORMS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--delete-obsolete` when uploading sources.                                                                                                                                                                                                                                                                                                                    | `upload_sources_args: --delete-obsolete` in `crowdin-push.yaml` — the upload-specific channel, not `command_args`; a dry run appends `--dryrun` (one word, which the CLI requires).                                                                                                                                                                                                                                                                                                                                                                                     | **CONFORMS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `update_option: update_without_changes`.                                                                                                                                                                                                                                                                                                                       | Set on every entry in `crowdin-conf.yml`; `checkCrowdinConfig` asserts the value per entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **CONFORMS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| _"When pulling translations from Crowdin, and when proof-reading is setup, export options **MUST** be configured so that only approved translations end up in the source code."_                                                                                                                                                                               | `'export_only_approved': 'true'`, asserted by value. Briefly `'false'` during this PR; reverted — D8g. **Whether a proof-reading step is configured on project 160 is NOT established** — the evidence we have (INTERN-1346, 28 Sep 2026) is that the team is ready to begin, which is readiness, not workflow configuration. `'true'` is correct either way: if proof-reading is set up the MUST applies, and if it is not, the MUST is dormant while the risk-table argument in D8g still holds and `'true'` is the conservative setting.                             | **CONFORMS** (after this PR) — the setting conforms unconditionally; the **condition** is unverified, see the proof-reading row below                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| _"export options `skip_untranslated_strings` and `skip_untranslated_files` are not specifically useful, and the former can lead to empty translations being exported (and only one of these options can be activated)"_, the default being that _"missing translations will be filled with the reference translation held by the source file"_.                | Neither option is set, and `checkCrowdinConfig` forbids both — as action inputs, as CLI flags in `command`/`command_args`/`download_translations_args`, and in `crowdin-conf.yml`. `skip_untranslated_strings` was set until 29 September 2026, and it did what the guide warns: the nightly pull (#293) exported every unapproved value blank (D8d, D8h).                                                                                                                                                                                                              | **CONFORMS** — neither option set, per the Technical Usage Guide. Unapproved strings arrive in English.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| _"If the code repository already holds translations for the target languages, they **SHOULD** be uploaded to initialize the project. These translations **MAY** be auto-approved."_ Technical Usage Guide: a **Project Content Initialization** step running `crowdin upload translations --auto-approve-imported` from the command line with the setup token. | **Not done.** By 5 October 2026 the risk it guarded had passed another way: French and German are 99% approved in Crowdin, and the pull NXSAT-293 merged turned none of the 75 translated keys `main` held back into English. The seeding run itself was never performed. The CI input built for this is removed, because CI was never the documented mechanism and the CI token was refused for scope — D8f.                                                                                                                                                           | **OWNER-ACTION-PENDING** — one local CLI run by the holder of the setup token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| The setup token **MUST** be revoked once setup is complete.                                                                                                                                                                                                                                                                                                    | Not held by this repository; CI uses a separate, narrower token that cannot upload translations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **OWNER-ACTION-PENDING**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| _"Defining the Crowdin Workflow **SHOULD** be up to the Translation Team. The default 'In-house translation' workflow, including a proof-reading step, is **RECOMMENDED**, although Crowdin offers Memory and Machine translation features that **MAY** be useful."_                                                                                           | No machine-translation workflow ships. One was written during this PR and removed before it landed: choosing MT is the Translation Team's call, not engineering's.                                                                                                                                                                                                                                                                                                                                                                                                      | **CONFORMS** (after removing it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| The commit author **must** be a non-human service account whose email matches the GPG key.                                                                                                                                                                                                                                                                     | Commits are signed, but the author is `github-actions[bot]@users.noreply.github.com` — GitHub's own App, on which no GPG key can be registered, so signatures show `verified: false`, `reason: unknown_key`.                                                                                                                                                                                                                                                                                                                                                            | **DEVIATES**, **OWNER-ACTION-PENDING** — needs a service account via GIAMI, which does not exist yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Third-party actions **MUST** be referenced by commit SHA (Third Party GitHub Action Version Conventions).                                                                                                                                                                                                                                                      | All three Crowdin workflows pin every third-party action by SHA with the tag as a trailing comment: `crowdin/github-action`, `actions/checkout`, `actions/setup-node`.                                                                                                                                                                                                                                                                                                                                                                                                  | **CONFORMS** (after this PR)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Sample source glob `/**/**/i18n/en.json`.                                                                                                                                                                                                                                                                                                                      | `/apps/*/public/i18n/en.json` — **one entry, apps only**. There is deliberately no `/libs/**` entry: Crowdin treats a pattern matching nothing as an error, and a forward-looking glob for NXSAT-284 once failed the push _after_ the catalogue had uploaded, which skipped the translator-context step behind it. It is added in the same change that ships the first library catalogue. `checkCrowdinConfig` rejects any source whose root is outside `apps/` or `libs/`, and separately fails each pattern that matches no file; it does **not** require both roots. | **DEVIATES-JUSTIFIED** — with `base_path: '.'` the sample sweeps `node_modules` and its 48 upstream catalogues, pushing another team's strings into our project.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Sample translation pattern `%locale%`.                                                                                                                                                                                                                                                                                                                         | `%two_letters_code%`, asserted by `checkCrowdinConfig`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **DEVIATES-JUSTIFIED** — `AppTranslateLoader` fetches `i18n/<lang>.json` for two-letter codes, so `%locale%` would download `fr-FR.json` and render English while reporting success (D8a). **No `languages_mapping` is needed**: the real pull in [#282](https://github.com/nuxeo/Nuxeo-Satori-UI/pull/282) produced `fr de es ja nl pl pt th zh`.json — bare two-letter names for all nine, including the region-qualified `zh-CN`, `pt-PT`, `nl-NL` and `th-TH`. Confirmed again on 5 October 2026 when NXSAT-293 dispatched the pull with `--language=zh-CN`: it wrote `zh.json`. |
| Translator-context helpers **SHOULD** be leveraged in future; the Guidelines record them as not yet explored.                                                                                                                                                                                                                                                  | Already built: `tools/i18n/crowdin-push-context.mjs` uploads 1,972 context entries from sibling `en.context.json` files, and `checkTranslatorContextPush` plus an ordering rule in `checkCrowdinConfig` keep the push from shipping sources without them.                                                                                                                                                                                                                                                                                                               | **EXCEEDS**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A proof-reading step in the Crowdin workflow is **RECOMMENDED**, and the export MUST above is conditional on proof-reading being _"setup"_.                                                                                                                                                                                                                    | **Confirmed 30 October 2026 (INTERN-1363).** Enrico Stengert: "A proofreading step has been implemented in the Crowdin project workflow, with additional localization QA performed after translation." That is the workflow configuration this row was waiting for, rather than the readiness INTERN-1346 showed — so the export MUST above is now binding rather than dormant, and approval is a gate rather than a formality nobody performs. | **CONFORMS.** The adjacent row below stays open: a proof-reading step existing is not the same as the project's export settings being approved-only, and those take precedence over the pipeline's. |
| _"project-level export settings in Crowdin take precedence over the settings used by pipelines."_                                                                                                                                                                                                                                                              | Unverified. Everything above configures the **pipeline**; if project 160 carries conflicting export settings, they win and this table describes intent rather than effect.                                                                                                                                                                                                                                                                                                                                                                                              | **OWNER-ACTION-PENDING** — confirm the project's export settings with the Crowdin admin.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### D8 — Crowdin configuration, and the one trap in it

Per the technical usage guide. Project name must match the GitHub repository name, so the project
was created as `agentic-ui-poc`; request creation via a Jira issue on the
[INTERN](https://hyland.atlassian.net/jira/software/c/projects/INTERN/boards/1031) project.

**The two names no longer match.** GitHub renamed this repository to `Nuxeo-Satori-UI` on
30 October 2026. Nothing in this repository renames a Crowdin project — `crowdin-conf.yml`
addresses the project by `CROWDIN_PROJECT_ID`, not by name — so project **160** still carries
`agentic-ui-poc` unless someone renamed it on the Hyland tenant, which we have not verified either
way. Re-aligning them is an INTERN request, not a change here, and nothing in the pipeline breaks
while they differ: the ID is what the workflows use.

```yaml
'project_id': '<assigned at creation>'
'api_token_env': 'CROWDIN_TOKEN'
'base_path': '.'
'base_url': 'https://hyland.api.crowdin.com'
'preserve_hierarchy': true

'files':
  - 'source': '/apps/*/public/i18n/en.json'
    'translation': '/%original_path%/%locale%.%file_extension%'
    'export_only_approved': 'true'
    'update_option': 'update_without_changes'
```

> **The trap: do not copy the standard's `/**/**/i18n/en.json` glob verbatim.** With
> `base_path: "."` it sweeps `node_modules`, which in this repo contains **48 upstream
> `i18n/en.json` catalogues** — adf-core's 19 locales, both adf-hx bundles, and satori-ui's 15. Uploading those would push Alfresco's and Satori's strings into our Crowdin project and
> bill the translation crew for work another team already paid for. Scope the globs to `apps/`
> and `libs/`, and verify with a `crowdin upload sources --dryrun` before the first real push (one word — the CLI rejects `--dry-run`).

### D8b — the pull is a daily POLL, not a daily pull request

I wrote, in this plan and in three other places, that an unowned daily translation PR "rots —
that is the documented failure mode in the Web UI process". Both parts of that were wrong, and
neither was ever checked before being repeated.

Measured on 20 Sep 2026 across every Crowdin pull request `nuxeo/nuxeo-web-ui` has ever had.
**Reproduce it before believing it** — the first version of this table was written from a
different, unstated query and every count in it was wrong:

```bash
gh api -X GET search/issues -f q='repo:nuxeo/nuxeo-web-ui is:pr head:crowdin' --jq '.total_count'
```

| Scoped to `head:crowdin`, 2022-06-06 to 2026-09-02 |                                    |
| -------------------------------------------------- | ---------------------------------- |
| Total                                              | 99                                 |
| Merged                                             | 39 — median lag **1 day**, max 294 |
| Closed unmerged                                    | 60 — median age **0 days**         |
| **Still open**                                     | **0**                              |

Two of those rows need reading carefully, because each looks like the opposite of what it is:

- **60 closed unmerged is not 60 abandoned translations.** The action pushes to one long-lived
  branch per base, so each run supersedes its own previous pull request — which is why the median
  age at close is **zero days**. Eight of the sixty lived longer than thirty days; that is the
  real tail, and it is small.
- **A 294-day maximum merge lag is not the typical experience.** The median is one day. Quoting
  the range alone would describe a process nobody has.

So they do not rot. And they are not daily: the cron polls daily, but a pull request appears only
when a translator has approved something. Thirty-nine merged across the fifty-one months measured
is roughly one a month, which is already the release cadence — arrived at by the mechanism rather
than by scheduling it.

So the daily schedule stays. On a day with nothing approved it opens nothing and costs nothing,
and it surfaces a broken catalogue within a day instead of on release day. What changes is the
question asked of the team: not "who owns a daily duty" but "who reviews this PR when it turns
up", which belongs on the release checklist.

The half that genuinely needs to be fast is the **push**, and it already is — on source change.
A string added today that does not reach Crowdin until release week cannot be translated for
that release.

### D8c — a source pattern must ship WITH the files it matches, never ahead of them

D8's snippet above deliberately omits a `/libs/**/i18n/en.json` source. Do not add it until a
catalogue exists, and the reason is not tidiness.

Crowdin treats a source pattern that matches nothing as an **error**, and it raises it _after_
uploading the files that did match. On the first real push the English catalogue uploaded
successfully and the job then failed on the empty `libs/**` pattern — so the run was red about
work that had succeeded, and because the job failed the translator-context step that follows
it never ran. A pattern added for a future slice is why Crowdin briefly held 1,972 strings with
no context attached, which INFO-144 requires.

`--dryrun` does not report it. The dry run listed the file it would upload and said nothing
about the unmatched pattern, so the CLI cannot be relied on to catch this before a real push.
`checkCrowdinConfig` fails each unmatched pattern by name instead, which is why the limitation
is survivable.

### D8d — an unapproved string is exported in English; neither skip option is set

**Corrected 29 September 2026.** This section used to say an untranslated string must be ABSENT
from the export, and that `skip_untranslated_strings: true` would leave the key out. That was
never tested, and for our nested JSON it is false: Crowdin keeps the key and exports a **blank
value**. The nightly pull of 29 September
([#293](https://github.com/nuxeo/Nuxeo-Satori-UI/pull/293)) carried nine catalogues in which every
one of the 1,972 values was `""`, apart from 8 approved strings each in `fr.json` and `de.json`.
`checkTranslationCatalogues` failed it with a line per blank value. That was the correct outcome,
because merging it would have blanked every French and
German label. The Technical Usage Guide had warned of exactly this: _"the former can lead to empty
translations being exported"_.

**The configuration now follows the standard.** `export_only_approved: 'true'` and neither skip
option. A string not yet approved is exported with its English source, so **every catalogue
arrives at full key parity with `en.json`**. `checkCrowdinConfig` forbids both skip options on
every channel that reaches the CLI (D8h).

How the option came to be set in the first place. The first real pull opened a pull request with
nine catalogues, every one byte-identical to `en.json`: 1,972 keys, 1,972 values the same as
English, none different. It was also destructive, because an export replaces the whole file and
`fr.json` and `de.json` held 75 and 76 hand-written strings. `Supprimer` came back as `Delete`,
in a commit titled "update translations from Crowdin". `skip_untranslated_strings: true` was
added to prevent that, on the untested belief that it would omit the key.

What a reviewer should expect from a pull now:

- A catalogue that is **entirely English** means nothing has been approved for that language yet.
  `checkCataloguesAreTranslated` fails it on purpose, and the pull request stays red until approvals
  exist.
- A catalogue that is **mostly English** (80% or more) warns and passes. That is the case to read
  carefully. A translation held in the repository but not approved in Crowdin comes back as its
  English source, and no check fails on it. Measured on 29 September: with 8 strings approved per
  language, the pull was 99% English and passed, and it would have reverted all 150 hand-written
  French and German strings on `main`. Until D8f seeding is done, do not merge a pull whose diff
  turns a hand-written string back into English.
- `checkTranslationCatalogues` still warns rather than fails on a key a locale lacks, because a key
  added since the last pull is legitimately missing until the next one.

Three things the first pull cost, each worth keeping:

- **Full key parity is not evidence of translation.** It was the reassuring signal and it was
  produced by the defect: the export covered every key, so parity was perfect.
- **The gate that failed was the wrong gate.** `checkTranslationCatalogues` passed. What went
  red was `checkLocaleDataRegistered`, because seven of the nine locales were new and had no
  Angular locale data — unrelated, real, and the only reason anyone looked. Restricted to `fr`
  and `de`, which are already registered, `review:guardrails` printed
  `Review guardrails passed.` over the loss of 151 strings. `checkCataloguesAreTranslated` now
  fails a catalogue whose every value matches English, and warns above 80%.
- **Crowdin started empty while 151 translations already existed**, so every pull was destructive
  by construction — no export option changes that, it only changes how they are lost. Seeding
  them into Crowdin is the fix, and the standard agrees: existing repository translations SHOULD be
  uploaded to initialize the project. A `seed_translations` CI input was built to do it and **has
  since been removed** — the documented mechanism is a one-time local CLI run with the setup
  token, not a CI step, and the CI token was refused for scope. **D8f is the current record; this
  bullet describes how it was found, not what we do.**

### D8g — `export_only_approved` stays `'true'`; the case for `'false'` was wrong

It was `'false'` for the length of one working tree, and this records the round trip rather than
the destination, because the reasoning is the useful part.

**The standard is a MUST, and we had not read it.** [Guidelines for Localization Management with
Crowdin Translations Tool](https://hyland.atlassian.net/wiki/spaces/HXP/pages/1891566724/Guidelines+for+Localization+Management+with+Crowdin+Translations+Tool)
— HXP space, status **ACCEPTED**, RFC 2119 language, four named approvers — says: _"When pulling
translations from Crowdin, **and when proof-reading is setup**, export options MUST be configured
so that only approved translations end up in the source code."_ The whole argument below was
conducted without knowing this document existed.

**The mechanical finding was correct and is worth keeping.** Machine pre-translation cannot
approve what it adds. `--auto-approve-option` "defines which translations added by **TM**
pre-translation should be auto-approved", our translation memory is empty, so `--method=mt` is the
only usable method and its output is unapproved by construction. A pre-translated project with
`export_only_approved: 'true'` fills Crowdin and **exports nothing** — the application renders
English while every progress figure says the work is done.

**The conclusion drawn from it was wrong, twice over.**

- The premise of the argument for `'false'` — a project with no translators, where approval can
  never arrive — was already false when it was made. Enrico Stengert on
  [INTERN-1346](https://hyland.atlassian.net/browse/INTERN-1346), 28 September 2026: _"I can
  confirm all source strings for this project are synced and now visible in CrowdIn. Translations
  can begin on our end."_ **That was readiness, not proof that a proof-reading step was
  configured**, and the MUST is conditional on proof-reading being _"setup"_ — so it did not on its
  own make the MUST binding. It did dispose of "approval can never arrive", which is what the case
  for `'false'` rested on. The configured workflow was confirmed separately on 30 October
  (INTERN-1363), so the MUST now binds directly. Recorded in
  `D8-standard`.
- The stronger reason does not depend on that timing at all. The Guidelines' **Identified Security
  Risks** table carries _"Reputation Damage (insertion of controversial or profane content through
  translations)"_ marked **Resolved**, and the justification is review: _"Translation teams work
  with the same trusted vendor and linguists for 7+ years and have NDAs… Nothing is crowdsourced
  by random people and every content is reviewed internally in addition to that."_ Exporting
  unreviewed machine output ships content no linguist has seen, so that row stops holding. A
  setting that quietly invalidates an accepted risk rating is not a trade engineering gets to make
  on its own.

**`'true'` is therefore right under either reading of the condition**, which is why the
proof-reading step being unverified did not leave this open at the time. It is verified now
(INTERN-1363, 30 October), so the first reading applies: the MUST binds directly.
If it is not, the MUST is dormant — but the risk-table argument still holds, and the cost of being
wrong in this direction is an empty export, which is visible, rather than unreviewed content in
front of a customer, which is not.

**So machine pre-translation is not ours to choose.** The Guidelines: _"Defining the Crowdin
Workflow SHOULD be up to the Translation Team. The default 'In-house translation' workflow,
including a proof-reading step, is RECOMMENDED, although Crowdin offers Memory and Machine
translation features that MAY be useful."_ A `Crowdin Pre-translate` workflow was written under
the earlier framing and is **not shipped**; whether to machine translate goes to the Translation
Team, and with approved-only export restored its output would not reach the application anyway.

`'true'` is stated **explicitly** in `crowdin-conf.yml` rather than left to the tool default, and
`checkCrowdinConfig` asserts the value rather than the key — a check that only counted the key
would have passed throughout the round trip.

### D8f — seeding is a documented SHOULD, but it is not a CI step

The `seed_translations` CI input is **removed**, and the 151 hand-written French and German
strings are to be **preserved, not superseded**. Those two statements looked contradictory in the
first version of this record, which is how it came to say the wrong thing.

A `seed_translations` input was built, to upload those 151 as approved translations. It failed on
the first real run:

```
UPLOAD TRANSLATIONS
✔️  Fetching project info
❌ Permission error: "Endpoint isn't allowed for token scopes."
```

The source upload in the same job succeeded, so this was neither authentication nor the project id.
The CI token is scoped to upload sources and download translations — exactly what the sync needs,
and deliberately not more. Uploading a translation is a separate endpoint outside that scope.

**What this record got wrong.** It read the scope refusal, and `nuxeo-web-ui` having never
uploaded a translation in four years, as evidence that Crowdin owns non-English content and the
151 strings should be allowed to lapse. The standard says the opposite. Guidelines: _"If the code
repository already holds translations for the target languages, they **SHOULD** be uploaded to
initialize the project. These translations MAY be auto-approved."_ Observed practice in a sibling
repository is not a standard, and it was treated as one.

**The mechanism is a one-time local CLI run, not CI.** The [Technical Usage
Guide](https://hyland.atlassian.net/wiki/spaces/HXP/pages/1891600892/Localization+with+Crowdin+Translations+Tool+Technical+Usage+Guide)
has a **Project Content Initialization** section that runs `crowdin upload translations
--auto-approve-imported` from the command line during initialization. It uses the **setup** token,
which the Global Administrator Guide notes "needs more permissions" for exactly this reason — not
the CI token, which correctly refused.

So removing the input was the right call for the wrong reason. The documented mechanism was never
a CI input, and a dispatch input that always fails is the dead surface this programme has shipped
before. **Seeding still has to happen**, as a one-time local step by someone holding the setup
token. It is not done, and it is not something this repository can do for itself.

One thing survives the removal: **the ordering rule in `checkCrowdinConfig`.** The seed step sat
between the source upload and the context push, so when it failed it skipped the context step
behind it — the shape D8c records, because a failed step skips the rest of the job. It cost
nothing only because the context was already in Crowdin and the script is idempotent. The rule
outlives the step: if a translation upload ever returns it must come last, since it has no bearing
on the sources or their context. The selftest covers all three paths — upload before context
(red), no context at all (red), and upload **after** context (green) — because the first two alone
are also satisfied by an implementation that simply rejects every upload.

A second thing was believed to survive and did not: `skip_untranslated_files: true` on the pull,
added here to stop a 0% language exporting an empty catalogue over `fr.json` and `de.json`. Neither
skip option is set any more. See D8h.

**Until seeding happens, the 151 are exposed.** Crowdin does not hold them, so each one that is not
approved there is exported as its English source, and an export replaces the whole file.

**Which job goes red matters, and an earlier version of this paragraph had it wrong.** The
`Crowdin Pull` run **succeeds**: the action downloads, opens the pull request and returns, and the
workflow has no step that checks the catalogues. `checkCataloguesAreTranslated` runs on the pull
request it opened, so the signal is a **red check on `chore(i18n): new Crowdin translations`**, not
a red scheduled run. Anyone watching only the Actions list for `Crowdin Pull` will see green every
night while the pull request beneath it is failing. Nothing reaches `main` either way. That is the
correct amount of noise for a prerequisite that has not been met, and it is the reason seeding is
recorded as required rather than optional.

**What `nuxeo-web-ui` measures, and why it is not a licence.** It predates this standard and is
not compliant with it, so it settles nothing — but the numbers are instructive. It sets neither
`skip_untranslated_strings` nor `export_only_approved`, and the cost of the first is visible in its
repository today:
`messages-cs.json` holds 1,565 keys at full parity with English, of which **1,558 are English** — a
Czech catalogue that is 99% English while presenting as Czech. `messages-id.json` is 39%. Full key
parity is what makes it look healthy, which is the whole subject of D8d. We set
`export_only_approved: 'true'` as the Guidelines require (D8g) and neither skip option (D8h), so
our catalogues are long and English-padded until strings are approved. `checkCataloguesAreTranslated`
fails one that is entirely English and warns on one that is 80% or more English, which is what
nuxeo-web-ui lacks.

### D8h — neither skip option is set, and both are forbidden

**Corrected 29 September 2026.** This section used to conclude that `skip_untranslated_strings` was
the option to keep. #293 showed that it blanks every unapproved value for our nested JSON (D8d), so
both options are now removed and `checkCrowdinConfig` forbids both. The history below is kept
because the pair conflict it records is still true of the toolchain.

`skip_untranslated_files: true` was added to the pull workflow alongside
`skip_untranslated_strings: true`, and a guardrail was written **requiring** it. The comments
carefully separated two distinct losses — a catalogue padded with English, versus a catalogue
emptied — and claimed one option guarded each. They cannot both be active:

> export options `skip_untranslated_strings` and `skip_untranslated_files` are not specifically
> useful, and the former can lead to empty translations being exported (**and only one of these
> options can be activated**).
>
> — Technical Usage Guide

The guide says the two are mutually exclusive; the pinned toolchain is blunter still and does not
pick a winner. It **fails**, so neither option took effect and no catalogue would have downloaded
at all — while a gate asserted both lines were present and the configuration was correct. **A gate
that is green about something untrue is worse than no gate.**

The rejection, quoted, because the earlier version of this section guessed at "one is silently
ignored" and that outcome is not reachable on this toolchain. `crowdin/github-action` turns both inputs into CLI
flags (`entrypoint.sh` lines 70–76 at the pinned SHA), the pinned image is `crowdin/cli:4.14.2`,
and that CLI rejects the pair before downloading anything:

```java
// crowdin-cli 4.14.2, PropertiesWithFilesBuilder.checkArgParams()
if (params.getSkipTranslatedOnly() != null && params.getSkipUntranslatedFiles() != null
    && params.getSkipTranslatedOnly() && params.getSkipUntranslatedFiles()) {
    messages.addError(RESOURCE_BUNDLE.getString("error.skip_untranslated_both_strings_and_files"));
}
// = "You cannot skip strings and files at the same time. Please use one of these parameters
//    instead."
```

`checkArgParams` takes the **CLI** params, so moving the setting into `crowdin-conf.yml` does not
avoid it — `FileBean` validates the same pair there.

**This section then kept `skip_untranslated_strings`, and that was wrong.** The argument was that an
English-padded catalogue passes as finished while an empty one is loudly wrong. It rested on the
option omitting the key, which it does not: it blanks the value (D8d, #293). A blank value is not
a louder form of the fallback. It renders as a blank label, and as a control with no accessible
name where the key is an `aria-label`. `skip_untranslated_files` is no better, because it withholds
a language until every string in it is approved.

**So the configuration follows the standard: approved-only export and neither skip option.** The
Technical Usage Guide treats English-filling as the default — _"By default, missing translations
will be filled with the reference translation held by the source file"_ — and the Guidelines name
`export_only_approved` as the only pull setting needed.

**The guardrail forbids both options, unconditionally.** `checkCrowdinConfig` fails on:

- **any** `skip_untranslated_strings` or `skip_untranslated_files` declaration on a Crowdin step in
  the pull workflow whose value is not literally `false` — including `'true'`, a trailing comment,
  and `${{ … }}`, which Actions resolves long after the gate runs;
- `--skip-untranslated-strings` or `--skip-untranslated-files` in `command`, `command_args` or
  `download_translations_args` on any Crowdin step, read through block scalars, since those are
  appended to the command verbatim; and an argument list built from an expression or alias, which
  cannot be read and so cannot be cleared. Any other literal argument passes, including the
  `--language=…` list the pull uses to download only the languages the app ships;
- either key anywhere in `crowdin-conf.yml`, since the CLI reads the same options there.

Each route was seen red on purpose against the real files, not only fixtures: each option was
added back to the real `crowdin-pull.yaml` as an input and as a `download_translations_args` flag,
and to the real `crowdin-conf.yml`, and all six went red for the named reason. Each has a negative
control.

The general lesson is the one this programme keeps paying for, and it repeated itself inside the fix
more than once. The original requirement was asserted against the _text_ of the workflow and never
against the tool that consumes it or the standard that governs it, so the guardrail proved only
that a broken configuration was present. Then the prohibition replacing it was written by
enumerating the spellings of "true" — several review rounds, one spelling at a time — until it was
clear that for a forbidden input **presence is the defect unless it is provably switched off**.
Enumerating what is forbidden does not terminate; asserting what is required does.

**The three rules that area now follows**, arrived at over ten review rounds in which nearly every
finding was one of them being applied backwards somewhere:

| Concern                              | Rule                                                                                                                          | Why that direction                                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step **selector** (`CROWDIN_ACTION`) | **Liberal.** Match the action however its `uses:` is quoted.                                                                  | An unrecognised step is an unchecked step. Recognising more steps means checking more steps, so breadth is the safe error.                                                         |
| Input **values** (`YAML_UNREADABLE`) | **Fail closed.** Anything not provably `false` — or not readable at all, including `${{ … }}` and `*aliases` — counts as set. | Clearing an input means asserting something about text. If the text is not the text the CLI receives, nothing can be asserted.                                                     |
| **Scope** (`crowdinActionSteps`)     | **The Crowdin steps.** Narrower than the file, wider than the step with `download_translations: true`.                        | Wider judges other people's actions and fails correct workflows — twice. Narrower misses a second step that downloads via `command: download`, which runs before the boolean path. |

All three live in one place each rather than being re-derived per check, because every time one was
re-derived it came back narrower or wider than the last.

### D8e — a language is advertised when it has translations, not when it is planned

> **Still in force, and extended, 30 October 2026.** The target set changed — it is now Nuxeo
> Web UI's ten — but the rule below survived that change unaltered: a language is advertised when
> it has translations. `D8e-webui` records the new set and which touchpoints a language may
> legitimately appear in before its catalogue exists.

Crowdin project 160 carries nine target languages. `availableLanguages` held seven — `en`, `fr`,
`de`, `ja`, `nl`, `th` and `zh` (Simplified Chinese, Crowdin's `zh-CN`) — since NXSAT-293 added
four on 5 October 2026, once each was 99% approved in Crowdin. That gap was deliberate and it was
not a backlog item to close on its own.

Three were still out, each for a reason a pull can clear:

- **`es`** was 99% approved but its catalogue maps `kd.knowledge-discovery.selected` ("Selected")
  to `Seleccionado(s)`, which `checkCatalogueValuesAreRenderable` fails as an `(s)` plural. It is
  fixed in Crowdin, not by hand, and lands with all four touchpoints on the next pull.
- **`pt`** is 88% approved.
- **`pl`** is 99% translated but 2% approved, held by 813 Crowdin QA issues.

Nothing renders `availableLanguages` yet: there is no language picker (NXSAT-294), and only the
config parser reads the list. A deployment chooses its language through `defaultLanguage`.

A locale needs three things that move together: a catalogue in `apps/nuxeo-ui/public/i18n/`, an
entry in `register-locale-data.ts`, and an entry in `availableLanguages`. The checks around them
are **not** symmetric, and this paragraph claimed they were until 30 October 2026:

| Missing piece                                    | What happens                                    |
| ------------------------------------------------ | ----------------------------------------------- |
| Catalogue ships, no locale data                  | `checkLocaleDataRegistered` **fails**           |
| Locale data registered, no catalogue             | `checkLocaleDataRegistered` **warns** — read it |
| Advertised in `availableLanguages`, no catalogue | `checkAdvertisedLocalesShip` **fails**          |

The warn-not-fail row is load-bearing for `D8e-webui`: it is why registration may run ahead of
the catalogues while advertising cannot. Verified against the implementation rather than this
table's previous wording, which asserted a failure the code never produced.

A fourth piece moves with them and is not checked at all: a `--language` in
`download_translations_args` in `crowdin-pull.yaml`, since the pull downloads only the languages
listed there. A fifth, easy to miss because it is in another library, is `DATE_FNS_LOCALES` in
`satori-date-adapter.ts` — a test holds its bare language ids equal to `availableLanguages`, so
that one cannot drift silently.

The temptation is to satisfy all three with an empty or English-filled catalogue so the picker
offers nine languages. Do not: that is the same fault `checkAdvertisedLocalesShip` was written
for, whose own comment records the template app "shipped describing two languages it could not
render". A user who selects Japanese and reads English has been lied to by the language picker.

So the nine were the target and the mechanism was ready for them. Each became advertisable in one
commit — catalogue, registration, `availableLanguages`, pull language — once Crowdin actually held approved
translations for it. How that content is produced is the Translation Team's decision, not ours:
the Guidelines leave the Crowdin workflow to them and recommend in-house translation with a
proof-reading step. Machine pre-translation is theirs to choose, and with `export_only_approved`
at `'true'` (D8g) nothing unapproved reaches the application either way.

### D8e-webui — the set is Nuxeo Web UI's, and half of it is still in flight

**Decision, 30 October 2026.** The application targets the ten languages Nuxeo Web UI supports:
`ar`, `nl`, `en`, `fr`, `de`, `he`, `it`, `ja`, `es`, `sv`. Thai and Chinese were dropped. Arabic,
Hebrew, Italian, Spanish and Swedish were added to the target, and **five of the ten ship**:
`en`, `fr`, `de`, `ja`, `nl`.

The useful part of this decision is not the list — it is which touchpoints a language may appear
in before it has translations. Of the six (five from D8e, plus the one NXSAT-733 added), they
split cleanly:

| Touchpoint                          | May run ahead?     | Why                                                                                                                                                                     |
| ----------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register-locale-data.ts`           | **yes**            | missing-catalogue is a warning; the reverse throws NG0701                                                                                                               |
| `--language` in `crowdin-pull.yaml` | **yes, with care** | it is the request that produces the catalogue — but the pull is ONE shared pull request, so an unapproved language listed here holds every other language's catalogue red |
| Catalogue in `public/i18n/`         | n/a                | it is the thing being waited for                                                                                                                                        |
| `SHIPPED_CATALOGUE_LANGUAGES`       | **no**             | `checkShippedCatalogueLanguages` fails **either** direction                                                                                                             |
| `availableLanguages`                | **no**             | `checkAdvertisedLocalesShip` fails it                                                                                                                                   |
| `DATE_FNS_LOCALES`                  | **no**             | a test pins it to `availableLanguages`                                                                                                                                  |

`SHIPPED_CATALOGUE_LANGUAGES` is the only one that cannot lag either: it is what
`resolveStringLanguage` consults, so a catalogue present without it is shipped and never
rendered. It therefore moves in the same commit as the catalogue, not before and not after.

So all five are registered and absent from the last three. **Only `es` is requested**: `ar`, `he`,
`it` and `sv` were taken out of `download_translations_args` on 30 October, because the pull
delivers everything into one shared pull request and an unapproved language would have held Spanish
and the four shipping languages red with it. So the `--language` row is "yes, with care" rather
than plain "yes": the flag may precede a catalogue, which is what produces one, but not approvals.

Each `--language` goes back when its approvals exist — in a change of its own, which must reach
`main` and then wait for a scheduled run, because the catalogue does not exist until that run
produces it. The last three entries come after that, in a third change — the one that brings the
catalogue. One change cannot be both before and after the pull.

The gate stays green throughout, which is the point: D8e's rule is not suspended, it is scoped.

An earlier revision of this branch did declare all ten at once and left `checkAdvertisedLocalesShip`
failing on five, on the reasoning that the red was a to-do list. That is recorded here because it
was wrong in a specific and checkable way rather than merely untidy: the repository's own
`pre-push` hook is `npm run review:guardrails`, so a branch in that state **cannot be pushed at
all**. A to-do list that prevents the work reaching review is not a to-do list.

Two things that follow, neither optional:

- **Do not seed empty or English-filled catalogues** to make a language advertisable sooner.
  `checkCataloguesAreTranslated` fails an all-English catalogue by design, and D8e is right about
  why: a user who selects Spanish and reads English has been lied to.
- **`ar` and `he` need RTL support, not just translations.** Component-level RTL already exists,
  across **three different mechanisms**, which is worth naming rather than counting because an
  earlier revision of this bullet said "seven components" and a count conceals the grouping:

  | Mechanism | Components |
  | --- | --- |
  | `:host-context([dir='rtl'])` in SCSS | `breadcrumbs`, `document-tree`, `folder-picker`, `pager` |
  | injects CDK `Directionality` | `document-list`, `document-tree` |
  | reads `getComputedStyle(…).direction` | `details-panel`, `rich-tooltip` |

  Seven distinct components, four of them via the CSS attribute — not seven via the attribute.
  `document-tree` appears twice. Re-measure rather than trusting the table:

  ```bash
  grep -rln "dir='rtl'" libs/shared/satori-components/src/lib --include="*.scss"
  grep -rln Directionality libs/shared/satori-components/src/lib --include="*.ts" | grep -v spec
  ```

  [#523](https://github.com/nuxeo/Nuxeo-Satori-UI/pull/523) adds what sets `dir` and writes the
  `Directionality` service so overlays follow. A catalogue alone does not make either shippable.

  This bullet said "nothing sets `dir`, so none of it activates", which read as a description of
  what a user sees. It is not: since NXSAT-733, `describeUnsupportedLanguage` refuses a
  `defaultLanguage` with no shipped catalogue, so `boot('ar')` applies `en` and neither language is
  **reachable** at startup. Nothing activates because nothing selects them, which is a different
  statement and the accurate one.

One cost was carried deliberately, and it is worth recording what it actually came to. The pull
list named `ar`, `he`, `it` and `sv` before Crowdin project 160 had them as targets, and the CLI
rejects the whole invocation rather than the unknown flag — so a scheduled run inside that window
would have failed for **every** language, not per-language. The alternative was to leave the
request out and have nothing pulling the new languages into existence, which trades a visible
failure for an invisible stall.

The window was **21 minutes** and no run fell in it: `main` gained the flags at 11:39Z on
30 October, INTERN-1363 made them targets at 12:00Z, and the workflow is `0 0 * * *`, so the runs
before it — 30 Oct 00:03Z — succeeded, and the next one is not due until 31 Oct 00:00Z, after the
window had closed. Twelve consecutive scheduled
runs succeeded.

So the bet came off, by luck rather than by design. This paragraph previously asserted the failure
in the present tense — "the nightly pull fails until they are added, and `fr`, `de`, `ja` and `nl`
stop updating with it" — and that never happened. The same claim was in `crowdin-pull.yaml` and
`docs/i18n-status.md`, and it reached a request to another team, where it made the ask sound more
damaging than it was. The mechanism is real and worth keeping; the tense was the defect.

### D8a — `%two_letters_code%`, not `%locale%`

The D8 snippet above maps translations to `%locale%.%file_extension%`. Built as written, that
is wrong for this application and wrong in the quiet way.

Crowdin's `%locale%` renders French as `fr-FR`. `AppTranslateLoader` fetches
`i18n/${lang}.json` using the language ngx-translate was handed, and Layer 0
`availableLanguages` holds two-letter codes — so the sync would download `fr-FR.json`, the
loader would request `fr.json`, every string would fall through to the English fallback, and
the pipeline would report success the whole time. An application that looks untranslated
while the tooling looks healthy.

`crowdin-conf.yml` therefore uses `%two_letters_code%`, and `checkCrowdinConfig` fails any
mapping that does not. A region-specific locale — `pt-BR` against `pt-PT` is the usual first —
needs a matching change in the loader and in `availableLanguages`, not a rename rule on its
own.

`update_option: update_without_changes` is the standard's current choice and it carries an
explicit assumption we inherit: **a developer must never change the meaning of an existing
key — change the key instead.** Put that in the maintenance checklist, because nothing
enforces it.

Two workflows, per the guide — the repository has three. `Crowdin Status`, a read-only progress
report, is an addition the guide does not describe; it is not part of the sync and is
dispatch-only:

- **Push** on push to `main` touching a source catalogue, `upload_sources_args: --delete-obsolete`.
- **Pull** daily on cron plus `workflow_dispatch`, `create_pull_request: true`,
  `export_only_approved`. Signed commits via the bot GPG key — this repo already has that
  infrastructure (`docs/github-bot-commit-signing.md`), so reuse it rather than minting
  another key.

Pin the action by SHA, not by tag: `@AGENTS/11-beta-program.md` and the HXP standard's own
security table both require it.

### Security note — an exposed token

[Crowdin Integration (i18n)](https://hyland.atlassian.net/wiki/spaces/NuxEng/pages/3148546309)
publishes a Crowdin **project ID and API token in plaintext** on a Confluence page. The HXP
standard is unambiguous — _"API Tokens MUST be considered as secrets, and shared via proper
usual secured means"_ — and its risk table makes revocation on improper disclosure the token
owner's responsibility. That token should be rotated and the page redacted. It belongs to the
`nuxeo-lts` platform project, not to us, so this is a report-and-hand-off, not a task in this
ticket. Worth doing before we add a second token to the estate.

### D9 — Sequencing constraint: translating `aria-label`s breaks two evidence harnesses

`scripts/beta-harness/steps/phase-6-a11y.mjs` selects on literal English accessible names —
`button[aria-label="Card view"]`, `"List view"`, `"Manage columns"`, `"Grid view"` — and
`phase-1-tag-styles.mjs` uses `"Close panel"` and `"Toggle details panel"`. Nine literal
selectors across two files. Translate those labels and both harnesses go red for reasons that
have nothing to do with the product.

**~~So 227b must migrate those selectors to `data-testid` before it translates a single
`aria-label`.~~ Corrected 19 September 2026 — it is not a prerequisite, and B0 in the build plan
below records why.** This sentence said the opposite of that correction and both were left standing,
which made the plan of record ambiguous on a sequencing decision. Only one of them can be followed.

What is actually true: Angular resolves the pipe and sets the attribute to the **resolved string**,
so in English the DOM is byte-identical and a literal-`aria-label` selector keeps matching.
`browse.details.toggle` has been through the pipe since before this work and
`phase-1-tag-styles.mjs` still selects it as `button[aria-label="Toggle details panel"]`.

The migration is therefore **required before those labels are localised**, not before they are
translated — the harnesses break on the first non-English run, not on extraction. It is tracked as
known-incomplete in `docs/i18n-status.md` rather than as a blocking slice, and the failure mode
recorded there is the one that matters: the selector matches nothing and the harness goes green
having asserted less.

The e2e specs under `apps/nuxeo-ui-e2e/` do not use `aria-label` selectors and are unaffected.

---

## Phase 3 — Build

Delivered as vertical slices per the `build-feature` skill: each one shippable on its own,
each leaving `main` green, each closed before the next opens.

### 227a — Beta slices

| Slice                            | Deliverable                                                                                                                                                        | Gate for the slice                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| **S1** Accessible-name fix       | Trailing-space alias in the seeded catalogue, `WORKAROUND(adf-hx): W#` marker, row in `docs/adf-hx-workarounds.md`, finding in `docs/adf-hx-upstream-findings.md`. | `guardrails` (`checkAdfHxWorkaroundIds` is bidirectional — it fails if either half is missing) |
| **S2** Catalogue validation      | `checkTranslationCatalogues` guardrail + unit test over every `i18n/*.json`.                                                                                       | `guardrails`, `test`                                                                           |
| **S3** Hard-coded-text guardrail | `checkNoHardcodedUiText`, diff-scoped, with `review-guardrails.selftest.mjs` registered as a gate.                                                                 | `guardrails`, deliberate red run captured                                                      |
| **S4** Chrome extraction top-up  | Extract the shell, nav and settings strings that S3 would now reject, so the guardrail is not born red. Bounded: `apps/nuxeo-ui` only, ~94 text nodes.             | `lint`, `test`, `build`                                                                        |
| **S5** Locale proof              | `fr.json` catalogue, bootstrap override, evidence steps file with a real `page.reload()`.                                                                          | `beta:evidence` exits 0                                                                        |
| **S6** Crowdin pipeline          | `crowdin.yml`, push and pull workflows, project requested and initialised, `CROWDIN_TOKEN` secret.                                                                 | Both workflows green; first sync PR reviewed                                                   |

S6 has an external dependency — project creation is manual and goes through INTERN — so
**request it at the start of S1**, not when you reach S6.

### 227b — GA slices

One slice per project, largest first, each its own PR. **B0 is not a prerequisite** — see the
correction in `docs/i18n-status.md`. Translating an `aria-label` leaves the English DOM
byte-identical, so a literal selector still matches; `phase-1-tag-styles` passes 21/21 today
against a piped label. The constraint that does bind is that the English catalogue value must
match the literal it replaces.

| Slice  | Scope                                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B0** | Migrate the nine literal `aria-label` selectors in `phase-6-a11y.mjs` and `phase-1-tag-styles.mjs` to `data-testid`. **Not a blocker** — worth doing because the harnesses stay locale-coupled and would break if run in `fr`, but extraction does not wait on it. |
| **B1** | `libs/features/document-detail` — 92 text nodes, 85 `aria-label`, 24 `title`. The heaviest.                                                                                                                                                                        |
| **B2** | `libs/features/administration` — 111 text nodes, 46 `aria-label`.                                                                                                                                                                                                  |
| **B3** | `libs/features/browse` — 96 text nodes, 51 `aria-label`.                                                                                                                                                                                                           |
| **B4** | `libs/shared/ui` — 68 text nodes, 24 `aria-label`. Shared, so it reaches all eight feature modules; run the blast-radius check.                                                                                                                                    |
| **B5** | `libs/features/search`, `collections`, `tasks`, `trash`, `assets`, `knowledge-discovery` — smaller, batchable.                                                                                                                                                     |
| **B6** | Per-library catalogue layout per D3, plus flip `checkNoHardcodedUiText` to repo-wide over the core slice.                                                                                                                                                          |

Strings in `.ts` files — snackbar messages, dialog titles, error text — are **not** in those
counts and were never surveyed. Budget a discovery pass in B1 before committing to B2–B5
estimates.

### Rough sizing

|                         | Estimate                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| 227a                    | 3–5 days, of which S6 is mostly waiting on project creation                              |
| 227b                    | 3–4 weeks of extraction, plus translation lead time                                      |
| RTL (separate, DS-2277) | 4–6 weeks Satori-side before we can start; "good enough" level, per the Satori l10n page |

---

## Phase 4 — Test

Four layers. The repo's own rule applies throughout: **`test` does not typecheck** — Vitest
strips types through esbuild — so a green `test` proves nothing about type safety. Only
`build` and `typecheck` do, and they run last.

### Unit

| Test               | Asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Catalogue validity | Every `i18n/*.json` parses, is UTF-8, has no empty-string values, sorted keys, newline at EOF. Required by the HXP standard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Key parity         | Asymmetric, deliberately — this row used to say a locale's key set must match `en.json` key-for-key, which D8d makes wrong. A key in `en.json` and absent from a locale **warns**: `setFallbackLang('en')` renders English, and a key added since the last Crowdin pull is legitimately missing until the next one. A Crowdin pull itself arrives at full parity, because unapproved strings export as English (D8d). A key a locale carries that `en.json` does not **fails** — nothing renders it and the translation crew is still paying to maintain it. Full parity is not evidence of translation: a catalogue whose every value equals English fails via `checkCataloguesAreTranslated`, because that is the English export under another name. |
| Loader precedence  | Seeded folders < app catalogue < manifest `labels`, asserted with all three supplying the same key. **Delivered** — `app-translate-loader.spec.ts`. This row said "currently untested" after the tests landed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Fallback parity    | Every key bound as an accessible name is present and non-empty in `en-fallback.ts`, enforced by `checkAccessibleNameFallbacks`. **Delivered, and the gaps it was written for are closed** — `settings.themes.search` was the one this row named; `shell.search.placeholder` and `shell.ai.input-placeholder` were two more, found later because the gate read only `aria-label` and `title` while those two inputs are named by their `placeholder` alone. `placeholder` is in scope now. A key in our own lowercase shape that no catalogue defines also fails, so a typo cannot pass as an upstream key.                                                                                                                                             |
| Guardrail selftest | Each new guardrail fires on a crafted violation and stays silent on a crafted near-miss. Negative controls counted separately from positive ones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Note for whoever touches `AppTranslateLoader`: `upstream-permissions-panel.spec.ts` defines a
`StubAdfTranslateLoader` duck-typing all five adf-core methods. **Add a method to the loader
and that stub must grow it too**, or the spec fails in a way that looks unrelated.

### Evidence capture

New steps file, `scripts/beta-harness/steps/nxsat-227-i18n.mjs`, run via
`npm run beta:evidence -- nxsat-227-i18n`. Per `_template.mjs`'s six rules, and per the
`assertions` gate, which parses steps files with acorn and **exits 1 if any assertion's
condition is a constant**. Do not record a limitation as `h.check(name, true)` — use `h.note`.

| Step                   | Load-bearing assertion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw-key sweep          | On each of the eight routes, no `aria-label`, `title`, **`placeholder`**, **`alt`** or text node **is** one of our catalogue keys, **contains** one as a word, or matches the upstream shape `/\b[A-Z][A-Z0-9_]*(\.[A-Z0-9_-]+)+\b/`. Not a single anchored regex: a word-dot-word pattern cannot separate `nav.refresh` from `report.pdf`, and the founding regression was the concatenated form `DOCUMENT_TREE.TOGGLE_ARIA-LABEL undefined`, which anchoring cannot match. **`placeholder` remains load-bearing for the AI assistant input** (still placeholder-named). **Global header search** (NXENG-798) names via an associated visible `<label>` — the French/German/fallback locale steps read that label text, not `placeholder`. The sweep walks **text nodes** via `rawKeysOnPage` (not leaf-element `textContent` alone), including label copy beside icons — e.g. `<button><mat-icon>…</mat-icon> nav.refresh</button>`. |
| Document tree          | The toggle's accessible name **contains that row's own visible label**, and contains neither a raw key nor the word `undefined`. Read from the DOM. Not `startsWith('Toggle')`: that passed on `Toggleundefined`, which is what the tree announced until W15, because upstream appends a `node.name` its node wrapper does not have.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| French locale          | Bootstrap set to `fr`, **`page.reload()` called**, shell chrome renders French. Without the reload `APP_INITIALIZER` never re-runs and the check is vacuous — this has caught people here before.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Empty accessible names | Two assertions, and the scope is narrower than "anywhere". **(a)** No `aria-label=""` on an interactive control — `button, a[href], input, select, textarea, [role=button], [role=link]` — which is the regression test for the `sat.*` critical finding. **(b)** No interactive control left with nothing naming it: no `aria-label`, no resolvable `aria-labelledby`, no `<label>`, no `title`, no `placeholder`, no text of its own once `aria-hidden` content is removed. Upstream's `<adf-datatable-row aria-label="">` is **excluded on purpose** — a row is not a control, cannot fail axe `button-name`, and is upstream finding 1.2. So this proves controls, not every node on the page.                                                                                                                                                                                                                                     |
| axe, French            | `h.expectNoA11yViolations` on the French shell, with **no** ignore list and `failOn` set to every impact including `minor` and `moderate`. The helper defaults to serious and critical only, which would have let a minor finding produce a PASS under a check named "no WCAG 2.1 AA violations". Phase 6 passed the same surfaces in English with `KNOWN_VIOLATIONS` empty as of 2026-08-24, which is what makes anything found here attributable to translation. **That premise is currently unsound:** five consecutive `phase-6-a11y` captures from 2026-09-15 to 2026-09-16 fail 3 `button-name` checks (browse, browse cards, column panel), so an English failure could be misread as a French one. Re-establish the English baseline before trusting a finding from this check.                                                                                                                                                |

Negative controls to run before trusting any of it: blank a catalogue key and confirm the
raw-key sweep goes red; remove the `fr.json` file and confirm the locale step goes red;
remove the `page.reload()` and confirm the French check goes **green** — which is the proof
that the reload is what makes it an assertion.

### Static and CI

- `checkTranslationCatalogues` and `checkNoHardcodedUiText` in the `guardrails` gate, which
  runs in `ci.yml` and in the fast inner loop `beta:gate -- --gates guardrails,lint`.
- Guardrail selftest as its own gate, following `sanitizer-selftest`.
- Extend `phase-6-a11y.mjs`'s existing "no catalogue blanks an accessible-name key" step from
  `sat.*` to every namespace.
- **Everything added to CI must be static.** `a11y.yml` documents why the live axe scan is not
  in CI: it needs a running Nuxeo through the dev proxy, and this repo holds no
  `packages.nuxeo.com` credentials. An i18n job that needs a browser will not run there.

### Validation (via the `validate-fix` skill)

Cross-browser Chromium and WebKit; static and runtime a11y gates; the French locale exercised
by hand as well as by the harness. RTL explicitly **not** validated — out of scope per Q3, and
say so in the report rather than leaving it unstated.

---

## Phase 5 — Maintenance and future changes

### The recurring loop

| Cadence                   | Action                                                                                                                                                                                                                                                                                                                                                                                              | Owner         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Daily, automated          | Crowdin pull workflow opens a translation PR.                                                                                                                                                                                                                                                                                                                                                       | Bot           |
| Per PR                    | Review and merge the translation PR. Not a standing duty: a release-checklist line, per Q4 and the measurement in D8b. The claim that "a rotting translation PR is the main failure mode of this setup" was **not measured before being repeated** and does not survive being checked — of the 99 such pull requests `nuxeo-web-ui` has had, 39 merged at a median lag of one day and none is open. | Release owner |
| Per feature PR            | New keys go in `en.json` **only**. Tag the Jira ticket `translation`, per the Web UI process.                                                                                                                                                                                                                                                                                                       | Author        |
| 3 business days before QA | Manual check of `translation`-labelled tickets, so missing translations can still be requested in time. Adopted from the Web UI process, which documents this exact gap.                                                                                                                                                                                                                            | Release owner |
| Per adf-hx bump           | Confirm the new component's keys resolve — not merely that it renders. Registering a catalogue is not the same as loading it, which is what made the versions panel render `MANAGE_VERSIONS.DIALOG.TITLE`.                                                                                                                                                                                          | Whoever bumps |

### Standing rules

- **Never hand-edit a non-`en` catalogue.** Crowdin is the source of truth for every language
  but the reference one; a direct edit is silently overwritten on the next pull.
- **Never change the meaning of an existing key — change the key.** This is the explicit
  assumption behind `update_without_changes`, and nothing enforces it. A reworded English
  string keeps its approved translations, which will then be wrong in every locale.
- **Never blank a key to suppress a duplicate tooltip.** That is how `aria-label=""` reached
  every surface in the product and survived to a WCAG audit — invisible to anyone not using a
  screen reader. `checkTranslationCatalogues` now fails on it.
- **Crowdin tokens are secrets**, fine-grained, project-scoped, in GitHub secrets only.
  Scopes cannot be edited after creation; a scope change means a new token.

### Adding a locale — the touchpoints

> **Re-ordered 30 October 2026.** This list used to advertise the language at step 2, before any
> catalogue existed, and told you to do steps 2–4 in one pull request. That is wrong under
> `D8e-webui` and it fails closed rather than quietly: `availableLanguages` for a language with no
> catalogue fails `checkAdvertisedLocalesShip`, and since `.husky/pre-push` runs
> `review:guardrails`, such a branch cannot be pushed at all. Caught in review on
> [#522](https://github.com/nuxeo/Nuxeo-Satori-UI/pull/522).
>
> **A sixth touchpoint, 30 October 2026.** NXSAT-733 made `SHIPPED_CATALOGUE_LANGUAGES` the
> authority on whether a language renders at all, so it is now step 2's first entry and it is
> mandatory. A checklist that omits it sends you to ship a catalogue the application then refuses
> to use. Caught in review on
> [#531](https://github.com/nuxeo/Nuxeo-Satori-UI/pull/531) — the checklist, not the code.

**Step 1 — register and request it.** Items 1 and 2 wait on nothing and belong together. **Item 3
does not**: it waits on approvals, not merely on a translation existing, and it is a change of its
own that must reach `main` before a scheduled run can act on it. So this is three pull requests per
language in the worst case, and the reason is in item 3.

1. **Add the target language on the Crowdin project** (translation team). Until this is done, a
   `--language` for it makes the CLI reject the **whole** invocation, so the nightly pull fails for
   every language at once — including the ones with nothing wrong with them.

2. **Register Angular's locale data for it** — import `@angular/common/locales/<locale>` and add it
   to `LOCALE_DATA` in `apps/nuxeo-ui/src/app/i18n/register-locale-data.ts`. This step was missing
   from the list once, and the list is what someone follows: without it `checkLocaleDataRegistered`
   goes red, and if that gate is bypassed every `DatePipe`, `DecimalPipe` and `CurrencyPipe` throws
   `NG0701` — surfacing as `NG02100: InvalidPipeArgument` wherever a date renders, nowhere near the
   file that was changed.

   Translating strings and formatting dates are separate mechanisms, which is why this is a step of
   its own rather than a consequence of advertising the language. Only `en-US` is built into
   Angular. Registering early is the **safe** direction — a registration with no catalogue behind it
   only warns — which is what lets this sit in step 1.

3. **Add `--language=<Crowdin language id>` to `download_translations_args`** in
   `.github/workflows/crowdin-pull.yaml`. The pull downloads only the languages listed there, so
   without it the nightly pull never produces the catalogue. Nothing checks this yet. Confirm the id
   against the Crowdin project: these are Crowdin ids, not the app's locale ids.

   **Do this when the language has approvals, not before.** The pull delivers every listed language
   into one shared pull request, so one with no approvals arrives as an all-English catalogue,
   fails `checkCataloguesAreTranslated` (D8d), and holds every other language in that pull request
   red. Adding the flag early is safe for the CLI but not for the queue behind it.

   And it cannot be combined with Step 2. The flag has to be on `main` for a scheduled run to
   download anything, and Step 2 cannot precede the catalogue that run produces — so merge this,
   wait for a run, then do Step 2. One change cannot be both before and after the pull.

**Step 2 — advertise it, once `apps/nuxeo-ui/public/i18n/<lang>.json` has actually landed.** Not
before; each of these fails if it leads.

1. Add it to `SHIPPED_CATALOGUE_LANGUAGES` in
   `apps/nuxeo-ui/src/app/i18n/shipped-catalogues.ts`. **This is the one that makes the language
   render at all**: `resolveStringLanguage` refuses a `defaultLanguage` outside that list and
   boots in English instead, so a catalogue added without it ships and is never used — NXSAT-733,
   in the opposite direction. `checkShippedCatalogueLanguages` fails both a declaration with no
   catalogue and a catalogue with no declaration, so it moves in the same commit as the file.

2. Add it to `availableLanguages` in the packaged bootstrap defaults **and** in
   `libs/shared/app-config/src/lib/bootstrap-config.ts`, and add it to `DATE_FNS_LOCALES` in
   `libs/shared/ui/.../satori-date-adapter.ts` — a test holds the latter equal to the former, so
   they move together or the suite goes red. Bring any regional variant whose date-fns `P` differs
   from the base language with it.

3. **Check whether the upstream catalogue covers it**, because ours is not the only one rendering.
   `@hylandsoftware/satori-ui` ships 15 files in `i18n/` but only **seven distinct languages** —
   `de en es fr it pl pt`. A language outside those gets English satori-ui strings inside an
   otherwise translated application, which reads to a user as a bug rather than as a gap.

   Measured 30 October 2026, and it is worse than "check the new one": **five of the ten languages
   we target are absent** — `ar`, `he`, `ja`, `nl`, `sv` — and `ja` and `nl` ship **today**. So this
   is a live gap, not a hypothetical for the next language. Re-measure rather than quoting the
   figures here:

   ```bash
   ls node_modules/@hylandsoftware/satori-ui/i18n/*.json | xargs -n1 basename | sed 's/.json//'
   ```

   This item used to cite adf-core's 19 locales and adf-hx's seven beside that count. Both are
   gone — no `@alfresco` package has been installed since NXSAT-637 and the adf-hx bridge went with
   NXSAT-635 — so only the satori-ui half still describes anything that runs.

4. Add it to the evidence capture's locale matrix.

The gap between steps is however long translation and approval take, and a language sitting in it is in
its normal state rather than a half-finished one.

### Known debt this plan deliberately leaves open

| Item                                 | Why it is being left                                                                                                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RTL                                  | Separate initiative, [DS-2277](https://hyland.atlassian.net/browse/DS-2277). Satori needs 4–6 weeks of its own work before an app can start. Arabic and Hebrew are Web UI release-blocking locales, so this returns at GA.                                           |
| Language picker                      | `availableLanguages` stays validated-but-unconsumed after 227a. Own story; adf-core ships the component.                                                                                                                                                             |
| Strings in `.ts` files               | Not surveyed, not counted, not scoped. Discovery pass in 227b/B1.                                                                                                                                                                                                    |
| Date, number and currency formatting | Angular's `DatePipe`/`DecimalPipe` need `LOCALE_ID` wired to the selected language and the locale data registered. Untouched — a French UI currently renders English-formatted dates. Small, but it is not free, and it is the most commonly forgotten half of i18n. |
| Pluralisation                        | No `{count, plural, ...}` usage anywhere. ngx-translate needs `ngx-translate-messageformat-compiler` for ICU. Defer until a real plural string appears.                                                                                                              |
| Per-library catalogues               | Designed in D3, enabled by the existing loader, populated in 227b/B6.                                                                                                                                                                                                |

### Documentation to update, in the same PR as the code

- `AGENTS/03-angular-conventions.md` — the key-naming convention and the "never hand-edit a
  locale file" rule, so the next agent follows it without being told.
- `docs/adf-hx-workarounds.md` — the trailing-space alias row. The `checkAdfHxWorkaroundIds`
  guardrail is bidirectional and will fail without it.
- `docs/adf-hx-upstream-findings.md` — the upstream typo, alongside finding 4.6.
- `docs/adf-hx-beta-plan.md` — amend the 21 Aug decision to record what 227a delivered inside
  the descoped position, so the two do not read as contradicting each other.
- This file — as decisions Q1–Q4 are answered.
