# i18n — where we actually are

**Dated 29 September 2026** (the Crowdin state and the #293 note; other sections carry their own
measurement dates). Measured, not estimated: every number below comes from a command
that is quoted next to it, so it can be re-run rather than believed.

Re-measure before quoting anything here. The 16 September edition of this page claimed the gate was
**23 of 23 green** while `guardrails` was failing, and put the catalogue at **1653** keys when it
held 1968 — both figures had a command printed beside them and neither had been re-run.

## Languages that ship — 5 October 2026

| Language             | Catalogue | Crowdin id | Status                                                                                                                                                  |
| -------------------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| English              | `en.json` | source     | ships                                                                                                                                                   |
| French               | `fr.json` | `fr`       | ships, 99% approved                                                                                                                                     |
| German               | `de.json` | `de`       | ships, 99% approved                                                                                                                                     |
| Japanese             | `ja.json` | `ja`       | ships since NXSAT-293, 99% approved                                                                                                                     |
| Dutch                | `nl.json` | `nl`       | ships since NXSAT-293, 99% approved                                                                                                                     |
| Thai                 | `th.json` | `th`       | ships since NXSAT-293, 99% approved                                                                                                                     |
| Chinese (Simplified) | `zh.json` | `zh-CN`    | ships since NXSAT-293, 99% approved                                                                                                                     |
| Spanish              | —         | `es`       | **pending** — 99% approved, but `kd.knowledge-discovery.selected` is `Seleccionado(s)`, which `checkCatalogueValuesAreRenderable` fails. Fix in Crowdin |
| Portuguese           | —         | `pt`       | **pending** — 88% approved                                                                                                                              |
| Polish               | —         | `pl`       | **pending** — 99% translated, 2% approved (813 Crowdin QA issues)                                                                                       |

There is **no language picker** (NXSAT-294): `availableLanguages` is read only by the config
parser, so a deployment selects its language through `defaultLanguage`. Every shipped catalogue is
checked by `checkCataloguePlaceholders`, which fails a translation whose `{{ … }}` placeholders differ
from English; all six had zero mismatches when added.

This is the status page. The **plan** is [`docs/i18n-localization-plan.md`](i18n-localization-plan.md);
the two are separate on purpose, because a plan that carries its own progress report goes stale
silently and gets believed anyway.

|              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Beta ticket  | [NXSAT-227](https://hyland.atlassian.net/browse/NXSAT-227) — delivered, in review                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| GA ticket    | [NXSAT-284](https://hyland.atlassian.net/browse/NXSAT-284) — delivered, in review. This row said **not started** while the branch implementing it was open, and the same page measured its output two sections below.                                                                                                                                                                                                                                                                                                                                  |
| Pull request | [#198](https://github.com/nuxeo/agentic-ui-poc/pull/198) (NXSAT-227, merged) · [#217](https://github.com/nuxeo/agentic-ui-poc/pull/217) (NXSAT-284)                                                                                                                                                                                                                                                                                                                                                                                                    |
| Branch       | `feature/nxsat-227a-i18n` (merged) · `feature/nxsat-284-descriptor-labels`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Gate         | `lockfile, guardrails, lint, test, build, typecheck, api-surface` all pass as of 2026-09-22, **under Node 20** — on Node 25 a built-in `localStorage` shadows jsdom's and `test` reports 126 false failures. `guardrails` was RED on pristine `origin/main` earlier the same day (`header-search-focus-ring.spec.html` carried a hard-coded `placeholder`); NXENG-755 fixed it by binding the pipe. Re-measure rather than reading this: `nvm use 20 && npm run beta:gate`. This row said **23 of 23 green** for six days while that gate was failing. |

---

## Where extraction stands — measured by rendering, not by grepping

Last measured 2026-09-21 on branch `feature/nxsat-284-descriptor-labels`, by an audit that now
**selects** the pseudo-locale and refuses to report a total unless the `⟦` sentinel rendered. The
previous figure of 41 came from a run that could not prove the pseudo-locale was active at all.

|                                                                |           |
| -------------------------------------------------------------- | --------- |
| Catalogue keys, each with translator context                   | **1968**  |
| Descriptor labels carrying a `labelKey`                        | **191**   |
| Visible English strings under the `zz` pseudo-locale, 9 routes | **24–30** |

Re-measure rather than quoting the table; every figure in it is a moving count:

```bash
npm run i18n:audit                        # the 24, and the deep pass over dialogs and menus
node -e "const c=o=>Object.values(o).reduce((n,v)=>n+(v&&typeof v=='object'?c(v):1),0);\
  console.log(c(require('./apps/nuxeo-ui/public/i18n/en.json')))"   # catalogue keys
git ls-files '*.ts' | grep -v spec | xargs grep -oh "labelKey: '" | wc -l   # keyed descriptors
```

The third number is the only one that means "finished", and it is the only one
that was not available until recently. Key and call-site counts measure what was
extracted; they cannot see what was missed, because a hard-coded string is
invisible to a catalogue by definition. Rendering the application in a locale
where every catalogue-sourced string comes back accented is what makes a missed
one show up — `npm run i18n:audit`.

That instrument has been wrong twice, both times under-reporting:

- `<mat-icon>` text is a ligature NAME, so `settings` reads as English and is not.
  60 phantom findings, burying the real ones.
- Upstream ships only `en`, `fr` and `de`, so every adf-core and satori-ui string
  read as a miss until the generator produced a `zz` for those catalogues too — 22 more.
- The prose test required letters only, so anything with a number was skipped in
  silence: the five size buckets, every date range, `2 result(s)`.

## Slice 10 and slice 12 — 29 September 2026

Plan slices 10 and 12 of [`docs/i18n-full-extraction-plan.md`](i18n-full-extraction-plan.md), in
one pull request for NXSAT-284.

**Messages built in TypeScript are in the catalogue.** 160 new keys, each with translator context:
toasts, error and status messages, dialog titles, Knowledge Enrichment and Knowledge Discovery
progress and error text, Content Lake messages, sign-in errors. The English is byte-identical
to the literal it replaced, with one deliberate exception below. Messages thrown by a service and
shown by a page are translated where the page shows them — `SignInError`, `KdDiscoveryError`'s own
fields, `KeEnrichmentError.messageKey`, `PermissionWithNotificationResult.notificationErrorKey` —
except `ContentLakeIngestService`, whose stalled-ingest message is composed from status fields only
it holds, so it resolves the text itself.

**Plurals stay two keys, no ICU compiler.** The task due-date labels (`tasks.due-label.*` on the
Tasks page, `shell.task-due.*` in the navigation drawer) are the new plural pairs, chosen by
`count === 1` from one shared calculation, `taskDueDistance`. Several count-bearing messages use one form in
English (`… ({{ count }} failed)`, `Users ({{ count }})`); their context says so, because
languages that inflect those words will need plural rules. The French zero defect described under
_Pluralisation_ below applies to the new pair too.

**The guardrails that let these through are closed.** `checkNoHardcodedImperativeUiText` read a
toast's argument only when a literal came first, so `toast(wasLocked ? 'Document unlocked' :
'Document locked')` passed; it now reads the whole argument by counting parentheses, and also
follows a `SCREAMING_CASE` constant holding prose (`DOMAIN_CONTAINER_GUIDANCE` was passed by name in
five places). `checkNoHardcodedDialogText` catches the same two shapes inside dialog data. Run
against untouched `origin/main`, the new checks report 23 and 4 violations where the old ones
reported none.

**`checkNoHardcodedDescriptorText` is repo-wide.** On `origin/main` it reported 28 descriptors the
diff-scoped version had never looked at: the note editor's 24 toolbar labels (test metadata; now
`labelKey`s pointing at the keys the template already used) and the four packaged theme names (now
`labelKey: 'settings.themes.name.<id>'`, rendered through `descriptorLabel`). A customer who sets a
theme's `label` in `bootstrap.json` without a `labelKey` gets their label as written; a customer
theme may carry its own `labelKey`.

**Four smaller fixes.** Document types render through `docTypeLabel` (16 bindings), which falls
back to the type's own name, camel case split, for a custom type — never a raw `doc-type.*` key.
`<html lang>` follows the active language. The date picker's labels come from the catalogue. And
22 English values carrying a template line break plus indentation are single-spaced — the only
English text this change alters, and invisible in HTML text, which collapses whitespace anyway.

**Deliberately left hard-coded**, each for a stated reason: CSV export header rows (a file format
downstream tools key on); `Manage everything` / `Can collect` in the share-saved-search dialog's API
mapping and its external-user dialog, which double as data values mapped back to API rights; `versionLabel: 'Current'`, which is also the
publish dialog's form value; adf-hx port errors, which are diagnostics returned to the upstream
library; product names (`Nuxeo Drive`, the Layer 0 branding defaults); and `apps/nuxeo-satori-template`
(slice 11).

## Translator notes — 29 September 2026

AC3 asks that every string carry context with product names flagged do-not-translate and acronyms
expanded. Every key already had a note; 1,275 of 2,135 are still the generated kind ("Visible text
in X"), and are deliberately left that way. Per decision D3, the hand-written set is the strings
that need judgement. 242 notes were written or rewritten: strings naming a product (Nuxeo, Content
Lake, Knowledge Discovery, Knowledge Enrichment, Hyland, HxAI, OAuth, Context API), strings with an
acronym (AI, CSV, NXQL, HTTP, JSON, HTML, URL, XML, ID and others), and 128 single words that read
as a noun or a verb ("Share", "Edit", "Comment", "Type", "State", "Modified", "Due", "Lock"), each
stating which one it is in that place.

`checkTranslatorNotesFlagProductsAndAcronyms` keeps the first two from regressing: a string
containing a listed product name needs "do not translate" in its note, and one containing a listed
acronym needs the expansion. Both lists sit together at the top of that check.

## Locale-aware date formatting — closed 2026-09-22

Eleven call sites formatted dates with a hardcoded `'en-US'` or a bare `toLocaleDateString()`
(which reads the **host machine's** locale, not the user's choice). All now take `LOCALE_ID`,
**and `LOCALE_ID` is now provided from Layer 0 configuration** — see gap 10 below, which this
closes.

That second half is the one that makes the first half mean anything, and it was nearly shipped
missing. An earlier revision of this section claimed closure while `LOCALE_ID` had no provider at
all, so Angular supplied its built-in `en-US` to every injection and a French or German
deployment still rendered every one of these dates in English. Correct plumbing feeding a
constant. Gap 10, six hundred lines below on this same page, said so at the time.

The provider is in `provide-app-config.ts` and shares `resolveFormattingLocale()` with the
`APP_INITIALIZER` that sets adf-core's locale, so Angular's formatting locale and adf-core's
cannot drift apart. Proven by `LOCALE_ID provider` in `provide-app-config.spec.ts`, which
asserts `fr` and `de` resolve from configuration and an unregistered locale falls back to `en`;
deleting the provider turns all four red.

The grep that must stay empty:

```bash
grep -rn --include='*.ts' -E "toLocale(Date|Time)?String\('en-US'|toLocale(Date|Time)?String\(\)" \
  apps libs | grep -v '\.spec\.'
```

Three lessons from it, each of which cost something:

- **`aceTimeFrame` and `permissionLabel` existed as three copies each**, in browse,
  collection-detail and document-detail, and every copy had the same two bugs. They are now
  `formatAceDateRange` and `permissionRightLabel` in `nuxeo-client`. The date half was a bug; the
  **English half was unfixable** — `from ${begin} to ${end}` is assembled at runtime, so no
  catalogue entry can reach it and no translation could ever have applied. The
  `permissions.time-frame.*` keys it now uses were already in `en.json` **and already used** by
  `share-saved-search-dialog`, which has a fourth copy of the same four-shape branching. That one
  stays: `parseTimeFrame` reads its own label back by splitting on the `range` separator, so its
  dates must remain unformatted.
- **A test asserting `toLocaleDateString()` against `toLocaleDateString()` proves nothing.**
  `browse.state.spec.ts` compared `getCellValue` to a bare `toLocaleDateString()`, so it agreed
  with the hardcoded implementation on every machine and could not have caught the defect. On a
  day-first host it expected `1/3/2026` where the column must render `3/1/2026`. Locale
  assertions must be **differential** — `de-DE` ≠ `en-US`, with both literals written out.
- **`inject(DatePipe)` throws NG0201.** Listing `DatePipe` in a component's `imports` makes it
  usable as `| date` in the template; it does **not** provide it for injection. This took six
  app-shell specs down. Use `formatDate(value, format, locale)` from `@angular/common` — a pure
  function needing no DI — rather than `providers: [DatePipe]`.

### Two traps for whoever measures this next

- **Never hand-edit `fr.json` or `de.json`.** Crowdin owns them and overwrites local edits on the
  next pull; the guardrail says so explicitly. An attempt to add keys to them here introduced
  curly quotes and left `de.json` as invalid JSON. `npm run beta:gate -- --gates guardrails`
  catches that in ~2s with an exact line and column — verified by reintroducing the breakage on
  purpose. Caveat: while a catalogue is unparseable the guardrail reports **only** that and masks
  every other finding, so it needs a second green run after the fix.
- **`--skip-nx-cache` does not skip the Angular build cache.** `nx test nuxeo-ui` (Karma) can
  rebuild a bundle from `.angular/cache` that still contains stashed-away changes, so
  stash-and-compare gives a **contaminated baseline**. It reported an identical "6 failed, 149
  passed" with and without a change that was in fact causing all six. Compare failure **causes**,
  not counts or test names.
- **Node 25 makes `nx test` lie.** A built-in `localStorage` shadows jsdom's, so
  `nuxeo-client`, `browse` and `document-detail` report 7, 48 and 71 failures, all
  `Cannot initialize local storage without a --localstorage-file path`. Under the pinned Node 20
  (`nvm use 20`) all three are green. Always confirm on 20 before believing a red.

### Reopened and re-closed 2026-10-12 (NXSAT-628): the grep above could not see two of them

"Closed" above was true of the eleven call sites that grep finds and false of the product. Two
more — the History tab's Date column in `document-detail.html` and `collection-detail.html` —
took their `DatePipe` format from the **translation catalogue**:

```html
{{ entry.eventDate | date: ('collections.mmmm-d-yyyy' | translate) }}
```

The grep looks for `toLocaleDateString`, so neither was ever a candidate, and both were already
using `LOCALE_ID` correctly — they just handed the pipe a hardcoded `MMMM d, yyyy`. `M`, `d` and
`y` are locale-**independent** tokens, so French rendered `octobre 12, 2026`: the English field
order wearing a French month name. Measured, not argued — `formatDate` with that pattern against
`longDate`, in all seven shipped locales, differs in six of them.

Two things worth carrying forward:

- **It was reported by the translators, not by us.** The keys reached Crowdin and Łukasz
  Biedrzycki asked why format patterns were being sent for translation. No gate was looking: the
  extraction codemod slugs a key from its value, and `mmmm-d-yyyy` is the codemod recording that
  it read `MMMM d, yyyy` as prose. `checkNoTranslatableDatePatterns` now fails both halves of
  that — a catalogue value that is nothing but a date pattern, and any `date:` format routed
  through `translate`.
- **"Never hand-edit a non-English catalogue" has one exception, and it is not translation.**
  Deleting a source key leaves the six non-English catalogues carrying it, which
  `checkTranslationCatalogues` fails as an _extra_ key. Its own remedy — push sources with
  `--delete-obsolete` — only runs on merge to `main`, so the pull request cannot be green until
  the key is gone locally too. Removing it is safe **only because the value was untranslated
  English**; verify that before deleting, and never remove a real translation.

### Pluralisation 2026-09-22: ICU deferred, but French is wrong today — and the first reason given was false

The catalogue holds **22** `-one`/`-many` key pairs (`grep -c '\-one":' apps/nuxeo-ui/public/i18n/en.json`),
selected by `count === 1 ? '…-one' : '…-many'` at each call site.

**The original justification for deferring ICU was that "en, fr and de each need exactly two plural
forms". That is false, and it was asserted without being measured.** What `Intl.PluralRules`
actually reports:

```bash
node -e "for (const l of ['en','fr','de']) { const p = new Intl.PluralRules(l);
  console.log(l, p.resolvedOptions().pluralCategories.join(','),
    '| 0 ->', p.select(0), '| 1e6 ->', p.select(1000000)); }"
```

| Locale | CLDR categories      | `0`     | `1000000` |
| ------ | -------------------- | ------- | --------- |
| `en`   | one, other           | other   | other     |
| `de`   | one, other           | other   | other     |
| `fr`   | **one, many, other** | **one** | **many**  |

French has **three** categories and treats **zero as singular**. So `count === 1` is the wrong
test for French:

- **Zero is a live defect.** `search.html` renders `resultCount() === 1 ? 'common.count.result-one' : '…-many'`,
  and a search with no hits therefore reads **`0 résultats`** in French where CLDR requires
  **`0 résultat`**. The same applies to every `common.count.*` pair that can render zero.
- **A million is theoretical here**, but `found-result-many` would take French's `other` form where
  CLDR asks for `many`.

`nav.clipboard.aria-label-*` is **not** affected, and for a reason worth stating rather than
assuming: `clipboardNavAriaLabel()` returns `null` for a non-positive count, so zero never reaches
a key, and a clipboard cannot hold a million items.

**ICU remains deferred, on the corrected premise.** Two keys plus a `=== 1` test is not
CLDR-correct for French, so the honest position is that this is known debt rather than a
sufficient design. The cheap partial fix is to select the singular for `0` **and** `1` in French —
which is locale-dependent branching in 22 call sites, i.e. the thing ICU exists to remove. Adopting
`ngx-translate-messageformat-compiler` costs a dependency, a compiler in `app.config.ts` and 22 key
migrations, and it is the only option that is actually correct.

Escalate this before the Crowdin spend, not after: translators asked for two French forms will
supply two, and a later ICU migration re-opens every plural string. Adding any locale needing 3–6
forms (Polish, Russian, Arabic, Czech) makes ICU unavoidable.

### `aria-labelledby` is not a translatable string — do not "fix" it

A 2026-09-22 sweep flagged five `[aria-labelledby]` bindings as untranslated and recommended
`[aria-labelledby]="'some.key' | translate"`. **That change would break accessibility, not fix
it.** `aria-labelledby` takes a space-separated list of **element IDs**; translating it leaves the
control pointing at an element that does not exist, so it loses its accessible name entirely —
the exact defect the "fix" claims to repair. The existing markup is already correct: the ID is a
stable hook and the element it references holds the translated text. `aria-label` takes a string
and _should_ be translated; `aria-labelledby` and `aria-describedby` take IDs and must not be.

The same sweep cited `aria-label="Clear full text"`, `"Comment actions"` and `"Filter options"`
as hard-coded. None of those strings exist in the codebase — they are already-translated keys in
`en-fallback.ts`, and the quoted line numbers pointed at unrelated code. Verify a finding against
the file before acting on it.

### What the remaining findings are

| Count | What                                                                    | Action                                                   |
| ----: | ----------------------------------------------------------------------- | -------------------------------------------------------- |
|     9 | `Skip to main content`, hard-coded inside satori-ui's compiled template | Upstream finding 1.4 — no host-side fix exists           |
|   4–6 | Repository content — document titles, custom type names, AI severities  | Instance data; translating it would corrupt user content |
|   3–6 | Generated AI insight sentences                                          | Written by the server                                    |

**Nothing here is actionable from this repository.** Every one is upstream, written by the server,
or customer data. Two rows this table used to carry are fixed and gone: the four packaged theme
names and `Open calendar` (29 Sep 2026, see _Slice 10 and slice 12_ above).

**The total is not a stable number, and quoting one is a mistake I made twice on this page.** It
first said 41, from a run that could not prove the pseudo-locale was active. Corrected to 24, then
the very next run reported 30 — and the whole difference was six AI insight sentences whose wording
the server regenerates each time: `Your workspace 'Narasimha' hasn't been updated in several weeks`
became `… in several days`. Same finding, different prose, different count.

So the figure in the table at the top of this page is one measurement, not a target, and a change of
a few either way means the AI wrote different sentences. What is stable, and what to watch, is the
first three rows — those are ours to the extent anything here is.

I also recorded the no-active-tasks sentence as our own empty state before checking: it appears
nowhere in `apps/` or `libs/`, so it is server-generated too. Grep before writing the row.

The count is a **floor** for nine first-render routes. Dialogs, menus and empty states are covered
by `pseudo-locale-deep.mjs`, which reports separately — most recently 5 distinct strings: the skip
link, `Open calendar`, the `Everything` permission identifier (sent to the server, so deliberately
untranslated), and the product names `Nuxeo Drive` and `macOS`.

### Still deliberately out of scope

`apps/nuxeo-satori-template` — 105 template strings and 26 descriptors. It is the
customer starter template, deferred by an explicit earlier decision.

## How to read this page

Three distinctions do most of the work here, and conflating any of them produces a wrong answer
about how far along we are.

**Internationalization is not localization.** i18n is the machinery — a key/value lookup, a way
to choose a language, a fallback when a key is missing. l10n is the content: the actual
translated strings. The Hyland Crowdin RFC governs only the second and says so in its Scope
section. **Our machinery has been done since Phase 1. The content is barely started.** Every
number that looks bad below is a content number.

**Mechanism working is not application translated.** The French screenshot in the evidence shows
a French search placeholder inside an otherwise English page. That is a true and useful result —
it proves a customer can change language with no rebuild — and it is not a localised product.

**Extraction is not translation.** Converting `>Show details<` into
`{{ 'browse.details.show' | translate }}` makes a string _translatable_. Somebody still has to
translate it, and per the standard that somebody is the Hyland translation crew working in
Crowdin, not a developer editing a JSON file.

---

## Coverage, measured

> **The three tables below are the NXSAT-227 measurement and are SUPERSEDED.** They say 60
> catalogue keys and 4 of 92 templates; NXSAT-284 took those to the figures in the table at the top
> of this page. They are kept because the before/after shape is the useful part of the Beta record,
> not the numbers. A five-model review found them being read as current, which is a fair reading of
> a table headed "Now".

### Translation keys

```bash
# flattened key count per catalogue
python3 -c "import json;d=json.load(open('apps/nuxeo-ui/public/i18n/en.json'));..."
```

|                              | Before (on `main`) | Now                  |
| ---------------------------- | ------------------ | -------------------- |
| Keys in the app catalogue    | **16**             | **60**               |
| Locales shipped              | 1 (`en`)           | 3 (`en`, `fr`, `de`) |
| Locales at full key parity   | n/a                | 3 of 3, gated        |
| Keys with translator context | 0                  | 60 of 60, gated      |

### Call sites

```bash
git grep -c "| translate" origin/main -- '*.html' | awk -F: '{s+=$3} END {print s}'
git grep -c "| translate" HEAD        -- '*.html' | awk -F: '{s+=$3} END {print s}'
```

|                           | Before  | Now     |
| ------------------------- | ------- | ------- |
| `\| translate` call sites | **7**   | **55**  |
| Templates using it        | 3 of 92 | 4 of 92 |

| Still hard-coded                 | Count         |
| -------------------------------- | ------------- |
| Template strings                 | **1350**      |
| Descriptor strings in TypeScript | **257**       |
| Passed imperatively in `.ts`     | never counted |

Four of ninety-two is the honest headline. It went up by one template because the work was
deliberately deep rather than wide: `app-shell.component.html` is at **zero** remaining
hard-coded strings, which no template in this repository was before.

`nav-drawer.component.html` is **not** at zero, and this passage claimed both templates were.
One string is left — `isOverdue(task) ? 'Overdue' : 'Due'` at line 266 — a quoted literal inside an
Angular expression, which `checkNoHardcodedUiText` does not inspect: the interpolation braces mean it
matches neither the element-text pattern nor the bare-prose one. It predates this diff, and the gate
is diff-scoped, so **the gate cannot certify either template as fully extracted** — it can only say
nothing new was added. That distinction is the honest version of this row.

Verified rather than asserted, twice over. The claim was false when first written — twelve strings
were left, all of them prose alone on its own line, the shape `checkNoHardcodedUiText` could not see
until this PR fixed it. A reviewer found those, not the gate that existed to. The ternary is the
thirteenth, found the same way.

### What is still hard-coded

Counting element text starting with a capital and `aria-label` / `title` / `placeholder` /
`matTooltip` / `alt` attributes with a literal value, excluding lines already using the pipe.

| Project                             | Templates | Text    | `aria-label` | `title` | Other attrs | **Total** |
| ----------------------------------- | --------- | ------- | ------------ | ------- | ----------- | --------- |
| `libs/features/document-detail`     | 4         | 96      | 85           | 24      | 31          | **236**   |
| `libs/features/administration`      | 12        | 125     | 46           | 0       | 20          | **191**   |
| `libs/features/browse`              | 5         | 106     | 51           | 2       | 25          | **184**   |
| `libs/shared/ui`                    | 12        | 75      | 25           | 0       | 16          | **116**   |
| `apps/nuxeo-ui`                     | 15        | 89      | 10           | 7       | 1           | **107**   |
| `apps/nuxeo-satori-template`        | 11        | 89      | 3            | 13      | 0           | **105**   |
| `libs/features/search`              | 3         | 44      | 16           | 0       | 13          | **73**    |
| `libs/shared/adf-hx-bridge`         | 13        | 35      | 19           | 10      | 3           | **67**    |
| `libs/features/tasks`               | 3         | 43      | 11           | 2       | 9           | **65**    |
| `libs/features/collections`         | 1         | 39      | 13           | 0       | 12          | **64**    |
| `libs/features/trash`               | 2         | 30      | 17           | 0       | 16          | **63**    |
| `libs/features/knowledge-discovery` | 3         | 30      | 14           | 1       | 2           | **47**    |
| `libs/features/assets`              | 3         | 16      | 7            | 0       | 4           | **27**    |
| `libs/extensions/acme-extensions`   | 2         | 3       | 0            | 0       | 0           | **3**     |
| others                              | 2         | 2       | 0            | 0       | 0           | **2**     |
| **Total**                           |           | **822** | **317**      | **59**  | **152**     | **1350**  |

`libs/shared/nuxeo-client` is the only project with no remaining strings, and it has one
template.

**`apps/nuxeo-ui` still shows 107** because two of its fifteen templates were extracted. The
rest, in descending size: `contracts-page` (24), `dashboard-page` (20), `profile-page` (17),
`nuxeo-drive-page` (15), `change-password-dialog` (8), `cloud-services-page` (7), `login-page`
(7), three smaller pages and `index.html`.

### Descriptors — a whole category the template count missed

**257 more user-facing strings live in TypeScript descriptors**, not templates. Nav entries,
packaged actions, column definitions and drawer links are data:

```ts
{ id: 'app.navbar.browse', label: 'Browse', icon: 'folder' }
```

rendered as `{{ item.label }}`.

| Project                         | Descriptor strings |
| ------------------------------- | ------------------ |
| `libs/shared/extensions`        | 59                 |
| `libs/features/assets`          | 35                 |
| `libs/features/search`          | 31                 |
| `apps/nuxeo-satori-template`    | 26                 |
| `libs/features/document-detail` | 25                 |
| `apps/nuxeo-ui`                 | 19                 |
| others (10 projects)            | 62                 |
| **Total**                       | **257**            |

Three things follow, and the first two are why this was invisible until someone looked at a
screenshot and asked whether the application was really in French.

**No amount of template extraction reaches them.** The translate pipe cannot be applied at a
descriptor definition, because the descriptor is Layer 1 data rather than markup.

**`checkNoHardcodedUiText` is structurally blind to them.** It reads added lines in `.html` and
sees `{{ item.label }}`, which is exactly the shape it asks for. `checkNoHardcodedDescriptorText`
now covers the gap, repo-wide since 29 Sep 2026, over `label`, `placeholder`, `ariaLabel` and `tooltip`. `title`
and `description` are deliberately excluded — they name Nuxeo document properties and schema
documentation as often as UI chrome, and a check that argues with the reviewer gets disabled.

**This is the most visible text in the product.** The entire left navigation is in this category.
A demo of the application in French shows a French search box beside a wholly English nav, which
is the single biggest reason the French screenshots read worse than the mechanism deserves.

The fix is not a sweep: the descriptor must carry a translation **key** and the pipe must move to
the render site — `{ label: 'nav.browse' }` with `{{ item.label | translate }}`. That keeps the
descriptor manifest-addressable _and_ makes the string translatable, which the current shape
allows only one of. It is a change to the Layer 1 descriptor contract, so it wants doing
deliberately and early in NXSAT-284 rather than being folded into a per-project sweep.

### The number nobody has measured

**The remaining `.ts` strings are still not counted.** The 257 descriptor strings above are
object-literal `label`/`placeholder`/`ariaLabel`/`tooltip` properties. Strings passed
imperatively — snackbar messages, dialog titles opened in code, error text, confirmation
prompts — are in neither figure. A discovery pass is
scoped as the first thing in NXSAT-284, precisely so the estimate for the rest is not built on
an unknown.

### Locale coverage is uneven upstream, and that bites

| Catalogue source                          | Locales shipped                    |
| ----------------------------------------- | ---------------------------------- |
| `@alfresco/adf-core`                      | 19                                 |
| `@hylandsoftware/satori-ui`               | 15                                 |
| `adf-hx-content-services` (ui + services) | **7** — `de es fr it pl pt` + `en` |
| ours                                      | 3                                  |

**A locale outside adf-hx's seven gets English adf-hx strings inside an otherwise translated
application.** That is why `fr` and `de` were chosen for the first pass: both are covered by
every catalogue we seed, so switching locale exercises the whole stack rather than our own file
alone.

---

## What existed before this work

Delivered by Phase 1 and Phase 3, and all of it still stands:

- **`ngx-translate` v17**, one hoisted copy, matching the `ngx-translate 16/17` norm across the
  CIC portfolio. No transloco remnants.
- **`AppTranslateLoader`** — merges N catalogue folders, then the app's own catalogue, then the
  manifest's `labels`. That last layer is a shipped **Layer 0** capability: a customer relabels
  the product with a JSON edit and no rebuild.
- **Four upstream catalogues seeded** — `adf-core`, both adf-hx bundles, `satori-ui` — because
  adf-hx registers its own catalogues at _component construction_, long after the language has
  loaded, so registration landed and the strings never arrived (`W6`).
- **`defaultLanguage` and `availableLanguages`** as Layer 0 bootstrap keys, validated and
  unit-tested.
- A compiled-in English fallback for a failed catalogue fetch.

Two things that were _not_ true, despite the ticket saying so:

- adf-hx translations were described as unwired. They were wired, and gated by the `bundle` gate.
- The raw-key defect was attributed to those unwired assets. It was an upstream typo.

---

## What was done now

### The defect that started it

`HxpDocumentTreeComponent` binds its folder toggle's accessible name to

```
('DOCUMENT_TREE.TOGGLE_ARIA-LABEL ' | translate) + node.name
```

— a **trailing space inside the key literal**. The catalogue ships the key without one, so the
lookup missed a key that was present, ngx-translate fell through to its key passthrough, and
every folder toggle in the tree was announced as `DOCUMENT_TREE.TOGGLE_ARIA-LABEL undefined`
— on **every surface**, because the tree is the app shell's nav drawer.

`undefined`, not the folder name. `Default domain` is only the label rendered _beside_ the toggle;
the toggle itself appends `node.name`, which upstream's node wrapper does not have. Writing the
folder name here obscured why the W13 alias alone was never going to be enough, and W15 is what
supplies a real name.

A WCAG 4.1.2 failure, and **axe cannot detect it**: axe checks that a control _has_ an accessible
name, not that the name is words. The blank-name variant of the same defect (upstream finding
4.6) was caught by axe in a single scan. This one sat through the same audit untouched.

Fixed by aliasing, which copies the _resolved_ value so a translated catalogue still yields a
translated name, and which yields to an upstream-shipped key so it becomes inert rather than
authoritative if upstream fixes it. Recorded as `W13` and as upstream finding 1.3, whose ask is
one character plus an interpolation parameter.

A **second instance of the same class** turned up on the way: `settings.themes.search` is the
themes search button's `aria-label`, it was in the catalogue and missing from the fallback, so a
failed fetch named that control with the raw key. Its catalogue value was also literally
`"Search (placeholder)"` — shipping as a real accessible name.

### Four gates, and the first controls any guardrail here has had

| Guardrail                      | Enforces                                                                                                                                       | Scope |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `checkNoHardcodedUiText`       | a hard-coded user-facing string in any template                                                                                                | repo  |
| `checkTranslationCatalogues`   | valid JSON, no blank values, trailing newline, no key `en.json` lacks (missing keys warn — D8d)                                                | repo  |
| `checkTranslationContext`      | translator context exists for every string and for no deleted one                                                                              | repo  |
| `checkAccessibleNameFallbacks` | every key bound to `aria-label`/`title`/`placeholder` or `method() \| translate` on those attributes plus `matTooltip` survives a failed fetch | repo  |

Plus `checkAngularDevAssets` extended to compare the `ignore` list, which it did not before — an
entry excluding a file in the base array and not in `development` read as identical while the two
configurations served different files.

`review-guardrails.selftest.mjs`. **Its totals are not restated here** — the suite prints them,
`npm run review:guardrails-selftest`, and a number copied into prose next to a list it does not
come from goes stale silently: this sentence said 58, then 71, while the suite held 78. It builds a
throwaway git repository per control under `os.tmpdir()`, so unlike the sanitizer selftest a hard
kill cannot leave a dirty tree. Registered as gate `guardrails-selftest`, as an npm script, in
`review:preflight` and in CI.

Eleven guardrails shipped before this with **no tests at all**.

### Extraction and locales

48 occurrences across the app shell and nav drawer, taking both templates to zero. `fr` and `de`
catalogues at full key parity. `en.context.json` carrying part of speech, surrounding UI, expanded
acronyms and do-not-translate flags for all 60 keys — 44 at the first extraction, and sixteen more
since, each added with its context because `checkTranslationContext` fails a key without one.

### Evidence

`npm run beta:evidence -- nxsat-227-i18n` → **PASS, 38/38 across 10 steps**, read from that run's
`manifest.json` rather than transcribed. Re-run it rather than trusting this line: the figure here
was `25/25 across 9 steps` from the 16 September run, which **predated five of the assertions it
was being cited as proving** — the adf-hx language check, the translated suggestion payload, the
French axe scan, route reachability and the date-formatting check were all added after it.

Asserts off the rendered DOM: no raw key in any `aria-label`, `title` or leaf text node on all
eight routes; the toggle named `Toggle <folder>`; `fr` and `de` differing from each other; an
unshipped locale degrading to English rather than to keys, and still rendering dates rather than
leaving them blank; a suggestion click sending the French string rather than the English one behind
its label; and **no axe violation at any impact** on the French shell — `failOn` is
`[minor, moderate, serious, critical]`, not the helper's serious-and-critical default — with no
ignore list.

Every language switch goes through a real `page.reload()`, because `withHashLocation()` makes
`goto()` same-document and without it `APP_INITIALIZER` never re-runs.

Six of those checks were failing when the assertions were first run honestly, and four of the six
were defects in the evidence rather than the application — a raw-key sweep reading `<style>`
elements, a route-reached check that rejected a legitimate child route, and a date check measuring
a surface that renders no date cells. The fourth was real: the French axe scan found the navigation
tree's folder toggles had no accessible name at all.

### Two defects found by running the application, which the controls did not catch

Recorded prominently because they are the more interesting failure: a capture that reported
**25/25 PASS** was live at the time, and both of these were present.

**`W14` — adf-hx surfaces silently reverted the language to English.** adf-core's
`TranslationService` reads the locale from its own `UserPreferencesService` and calls
`translate.use(...)` on the shared ngx-translate instance when it constructs. So
`defaultLanguage: 'fr'` held on the seven ordinary shell routes and reverted the moment the
`/#/browse-adf-hx` route or the adf-hx nav drawer rendered — no page reload involved,
`performance.getEntriesByType('navigation')` stayed at one entry, and all five catalogues were
re-fetched for `en`.

The capture missed it because step 5 navigated to `/#/browse` before asserting French — a `goTo`
added to get away from a drawer an earlier step had opened, which happens to be exactly the
navigation that avoids the bug. **The evidence was true and incomplete.** Fixed by re-asserting
our Layer 0 language into adf-core's preference on every boot, with a regression step that drives
the adf-hx surfaces explicitly.

A side effect worth knowing: upstream's own catalogues now resolve too. The document tree root
renders `Accueil` rather than `Home`, because adf-hx ships `fr` and was previously being fetched
as `en`.

**Missing Angular locale data — and the first bug was hiding it.** Once the locale actually
applied, `DatePipe` was handed `fr` for the first time and threw `NG0701: Missing locale data`,
thirty-six times on one pass. Translating strings and formatting dates are separate mechanisms;
only `en-US` locale data is built into Angular. Fixed by registering `fr` and `de`, gated by
`checkLocaleDataRegistered` so a catalogue cannot be added without its data — the symptom
otherwise appears as a pipe error on an unrelated page.

Then the same run showed eleven more for the deliberately-unshipped `xx` locale: strings degraded
to English correctly, dates threw. A customer mistyping `defaultLanguage` would get readable text
and a broken date in every list. Fixed by only handing adf-core a locale we have data for, so the
string language and the formatting locale are allowed to differ.

**The order matters and is the lesson: the i18n bug was hiding the l10n bug.** A half-applied
locale looks like a working one right up until it works.

### Defects found by the controls, not by review

Worth recording, because it is the argument for writing controls at all:

1. An unguarded `JSON.parse` in a new guardrail **crashed the whole script**, discarding every
   other guardrail's diagnostics. A trailing comma in `en.json` produced a stack trace and no
   guardrail report.
2. A parity branch reported "no en.json" for a file that was present but unparseable — a wrong
   message, which is worse than none.
3. A `.first()` selector read an adf-hx input instead of the header search box, which looked
   exactly like "the locale did not apply". Instrumentation recording the `defaultLanguage` the
   interception actually served is what separated the two explanations.
4. **CI caught one that every local run missed.** The selftest passed `--base` but not `--head`;
   CI sets `NX_HEAD`, so each fixture repo tried to diff against the real repo's SHA and all 33
   controls failed for one unrelated reason. Locally `NX_HEAD` is unset and everything was green.

---

## Standards position

| Question                       | Answer                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which translation tool?        | **Crowdin.** INFO-144's Weblate mandate is scoped to BitBucket; we are on GitHub, and Weblate is being retired on the Hyland Experience side.                                                                                                                                                                    |
| Which file layout?             | The **current Hyland/CIC** one — `i18n/en.json` + `i18n/<locale>.json`, which our repo already matched. **Not** Web UI's `messages.json`; that is a Polymer-era convention needing a locale-rename table we do not need.                                                                                         |
| Framework?                     | `ngx-translate` v17, already the portfolio norm.                                                                                                                                                                                                                                                                 |
| Fully compliant with INFO-144? | **No — one documented deviation.** INFO-144 requires a changed source string to be flagged for translator review. The HXP standard's `update_option: update_without_changes` does not do that, mitigating with a manual Crowdin filter plus the convention _never change the meaning of a key — change the key_. |
| Compliant on string context?   | Yes, and gated. (This row said "for the 60 keys that exist", which was the NXSAT-227 count.)                                                                                                                                                                                                                     |
| Compliant on concatenation?    | Ours, yes. **Upstream's tree is not** — `(translate) + node.name` cannot be reordered by a translator. Finding 1.3.                                                                                                                                                                                              |

---

## Next steps

### Immediate — what [#198](https://github.com/nuxeo/agentic-ui-poc/pull/198) is actually waiting on

**One thing: a human approval.** CI is green, every review thread is resolved, and nothing here
needs a repo admin.

`copilot-pull-request-reviewer` **never submits `APPROVED`** — it has not once in this repository,
across every pull request it has reviewed — so `reviewDecision` stays `REVIEW_REQUIRED` however many
rounds run. The query to verify that, and the exit condition it implies, are in
`AGENTS/09-pr-feedback.md`. Branch protection needs a human, and that is the only step left.

Both items this section used to list are **done**, and leaving them here contradicted the 23/23 gate
row twelve lines above:

- ~~Approve the `pull_request` workflow runs so CodeQL can analyse `refs/pull/198/merge`.~~ The runs
  have fired and `code-scanning` is green. No admin action outstanding.
- **Whether RTL is in scope does not block this PR**, which is why it has moved out of this section
  rather than being ticked off. Decision **Q3 in the plan is still formally open**, with a
  recommendation of _no_ for both Beta and the GA extraction — so calling it "answered" would be
  wrong in the other direction. Nothing in #198 implements or depends on RTL; it is tracked as
  [DS-2277](https://hyland.atlassian.net/browse/DS-2277) and listed under separate stories below.
- ~~Answer who owns the daily Crowdin translation PR.~~ Retired on 20 September 2026 — the premise
  that an unowned one rots is contradicted by the measurement in D8b of
  `docs/i18n-localization-plan.md`.

### Slice S6 — the Crowdin pipeline is LIVE; what is left is translation, not plumbing

This section said twice over that the pipeline was written but dormant and the project external.
Both stopped being true on 28 September 2026. It is activated and both halves have run against the
real tenant.

**In the repository.** `crowdin-conf.yml`, `.github/workflows/crowdin-push.yaml` and
`crowdin-pull.yaml`, and `tools/i18n/crowdin-push-context.mjs` for the translator context the JSON
source format cannot carry. `checkCrowdinConfig`, `checkTranslatorContextPush` and
`checkCataloguesAreTranslated` hold the shape.

**Activated.** Crowdin project **160** exists via
[INTERN-1346](https://hyland.atlassian.net/browse/INTERN-1346). `CROWDIN_PROJECT_ID`,
`CROWDIN_PERSONAL_TOKEN`, `BOT_GITHUB_TOKEN`, `GPG_PRIVATE_KEY` and `GPG_PASSPHRASE` are set, with
`CROWDIN_SYNC_ENABLED` and `GPG_BOT_SIGNING_ENABLED` both `true`.

**Both halves have run.**

- **Push.** 1,972 English strings and 1,972 translator-context entries are in Crowdin. The context
  is genuinely there rather than merely reported as sent, on two independent grounds: a second run
  reported `0 updated`, because the script compares against what Crowdin already holds; and the
  portal shows it, `action.bulk-actions-add-to-clipboard` carrying _"Action a user invokes from a
  menu or an icon button, and the accessible name of…"_. The second matters because the first is
  the script grading its own homework, and INFO-144's requirement is the kind of thing that gets
  reported as done on exactly that evidence. The editor also paginates at 40 pages, which at 50 a
  page corroborates 1,972 and rules out the duplicate upload the dashboard's "QA checks for 4,067
  strings" badge suggested.
- **Pull.** Opened a real pull request, #282, which also **confirms `BOT_GITHUB_TOKEN` has the
  scopes it needs** — CI started on the branch, which the default `GITHUB_TOKEN` would not have
  caused.

**What is left, and none of it is plumbing.**

1. ~~**Crowdin holds almost no approved translations.**~~ **Superseded on 5 October 2026** — this
   item records the 29 September state. By 5 October seven languages were 99% approved; NXSAT-293
   pulled `fr`, `de`, `ja`, `nl`, `th` and `zh` and found none of the 75 translated keys `main`
   held in `fr.json` or `de.json` reverting to English. See "Languages that ship" at the top. The
   rest of this item is kept as the record of how it was. Every one of its nine target languages was
   at zero in the portal on 28 September. By the pull of 29 September, French and German had 8
   approved strings each, and the other seven languages still had none. This is about
   **Crowdin's** state, not the application's: the repository ships 151 hand-written French and
   German strings, written before Crowdin existed, and those render today. None of the 151 is
   approved in Crowdin, which is why every pull so far has been destructive.

   Those 151 must be **preserved, and that is an open action** — see D8f. The standard says a
   repository's existing translations SHOULD be uploaded to initialize the project, and the
   documented mechanism is a one-time `crowdin upload translations --auto-approve-imported` run
   **from the command line with the setup token**, not from CI. The `seed_translations` CI input is
   removed because CI was never the mechanism; the CI token refused it for scope, correctly. **The
   seeding itself has not been done and this repository cannot do it** — it needs a token only the
   project owner holds.

   Until it is done, every one of the 151 that is not approved in Crowdin is exported as English
   over `fr.json` and `de.json`.
   **Watch the pull request, not the scheduled run.** `Crowdin Pull` opens the pull request and
   returns successfully — it runs no checks of its own — so the nightly job shows **green** while
   the checks on the `chore(i18n): new Crowdin translations` pull request it opened fail. Nothing
   reaches `main` either way, but an operator watching only the Actions list sees nothing wrong.
   Neither skip option is set; both are forbidden (D8h).

   Beyond those 151, every locale renders English: an unapproved string is exported with its
   English source, so the catalogues arrive at full key parity. **Translation has started, and
   approval has barely started.** Enrico Stengert on INTERN-1346, 28 September: the sources are
   visible and "translations can begin on our end". On 29 September the Crowdin portal showed
   fr/de/es/pl/pt 13% translated and ja/nl/th/zh 4%, with approval at 8 strings each in French and
   German and none elsewhere. Only approved strings are exported, so translated-but-unapproved work
   does not reach the repository. Translated, approved and shipped are three different things, and
   this page has conflated them before.
   The pipeline **requests** approved-only export (`export_only_approved: 'true'` — D8g), which is
   the MUST the Guidelines set. It is not yet proof of the effect: the Guidelines also say
   project-level export settings in Crowdin **take precedence over the settings used by
   pipelines**, and project 160's settings have not been checked. So the intended behaviour is that
   a language appears only once a linguist has passed it, and confirming that it is the actual
   behaviour is an owner action. Whether a proof-reading step is configured is likewise **not yet
   confirmed**, and whether to use Crowdin's machine-translation features is the Translation Team's
   decision, not ours. All three are open rows in `D8-standard`.

2. ~~**Project membership.**~~ Resolved on 28 September: Manager access granted on project 160.
   Worth keeping the lesson, because it cost a day of confusion — Okta access to the Crowdin
   tenant and membership of a project are **separate grants**, and holding the first shows you a
   portal with no projects in it, which reads like a broken account rather than a missing
   permission. There is a third level again: plain membership loads the dashboard but returns
   `403` on the source strings view, so progress percentages were readable while the strings
   behind them were not.
3. **Nine target languages, seven advertised** — `en`, `fr`, `de`, `ja`, `nl`, `th`, `zh` since
   NXSAT-293 (5 October 2026). `es`, `pt` and `pl` are pending; the reasons are in D8e in
   `docs/i18n-localization-plan.md`. A language is advertised when it has translations, not when it
   is planned.
4. **Bot commits are signed but not verified** — `verified: false`, `reason: unknown_key`. Not a
   missing upload: the author identity is `github-actions[bot]@users.noreply.github.com`, GitHub's
   own App, on which nobody can register a GPG key. Needs an account that can own the key.

**What the first pull cost, because it is the lesson of the slice.** It opened a pull request with
nine catalogues byte-identical to `en.json` and would have overwritten 75 hand-written French and
76 German strings. With no skip option set, an untranslated string is exported **with its English
source as the translation**. Full key parity was the reassuring signal and the defect produced it.
See D8d.

**29 September 2026 — the nightly pull exported blank values.** `skip_untranslated_strings: true`
had been added to stop the English overwrite, on the untested belief that it would leave an
untranslated key out. For our nested JSON it keeps the key and blanks the value. The nightly pull
([#293](https://github.com/nuxeo/agentic-ui-poc/pull/293)) carried nine catalogues with every
unapproved value `""` — all 1,972 in seven of them, all but 8 approved strings in `fr.json` and
`de.json` — and
`checkTranslationCatalogues` failed it, correctly. The Technical Usage Guide warns of exactly this.
The pull now follows the standard: approved-only export, neither skip option, and only the
shipped languages downloaded — `fr` and `de` then, `fr de ja nl th zh-CN` since NXSAT-293 (D8d, D8h).

Dispatched from that fix, the pull refreshed #293 to `fr.json` and `de.json` only, each 1,972 keys
with no blank value, 1,964 English and 8 approved translations. That is 99% English, so
`checkCataloguesAreTranslated` **warns and the guardrails pass**. It is not the all-English
failure. Merging it would turn all 75 hand-written French and 75 German strings on `main` back into
English, because none of them is approved in Crowdin. **Do not merge a Crowdin pull until the D8f
seeding is done**, or until the diff shows no hand-written string reverting. (5 October 2026: the
second condition held — the NXSAT-293 pull reverted none of them, because Crowdin approval had
caught up.)

One trap is already handled and must stay handled: the standard's `/**/**/i18n/en.json` glob, with
`base_path: "."`, sweeps `node_modules` and its 48 upstream catalogues — which would push
Alfresco's and Satori's strings into our project and bill the translation crew for work another team
has already paid for. `crowdin-conf.yml` is scoped to `apps/` and `libs/`, and `checkCrowdinConfig`
fails any source that is not.

### NXSAT-284 — GA extraction: 1350 template strings, 257 descriptor strings, plus an unknown number passed imperatively

> **Delivered in [#217](https://github.com/nuxeo/agentic-ui-poc/pull/217).** What follows is the
> PLAN as it was written, kept because the decisions and the corrected assumptions in it are the
> record of why the work took the shape it did. For what actually shipped, read the measured
> table at the top of this page — not the counts here, which are the estimate this planning
> produced.

6. **~~B0 first, and it blocks everything after it.~~ Corrected 19 Sep 2026 — it is not a
   blocker.** The claim was that translating the nine literal English `aria-label` values that
   `phase-6-a11y.mjs` and `phase-1-tag-styles.mjs` select on would turn both harnesses red, so
   the selectors had to move to `data-testid` first.

   That is wrong, and a live counter-example was already in the repository.
   `browse.details.toggle` has been bound through the pipe in `browse-adf-hx-poc.html` since
   before this work, and `phase-1-tag-styles.mjs` selects it as
   `button[aria-label="Toggle details panel"]`. That harness **passes 21/21**. Angular resolves
   the pipe and sets the attribute to the resolved string, so in English the DOM is byte-identical
   to the literal it replaced, and a literal selector still matches.

   The real constraint is narrower and belongs to the extraction rather than to a prerequisite
   slice: **the English catalogue value must be byte-identical to the literal it replaces.**
   Change the wording while extracting and the selector breaks — not because it was translated,
   but because the string changed.

   Migrating the selectors to `data-testid` is still worth doing, because the harnesses remain
   locale-coupled and would break if ever run in `fr`. It is cleanup with a real payoff, not a
   gate. **Per-project extraction can start immediately.**

7. Then one PR per project, largest first: document-detail (236, and the `.ts` discovery pass),
   administration (191), browse (184), `shared/ui` (116, shared so run the blast-radius check),
   then the smaller features.
8. **B6:** per-library catalogues, so `libs/platform` ships its own strings — it is a publishable
   package and strings in `apps/nuxeo-ui/public/i18n/` do not travel with it. This needs **no
   loader change**: `AppTranslateLoader` already merges N folders and exposes
   `registerProvider`. Then flip `checkNoHardcodedUiText` to repo-wide.

### Known-incomplete, and easy to read as done

- **Library catalogues are not packaged, so a package consumer sees raw keys.** `libs/shared/ui` and
  `libs/shared/extensions` reference **120 distinct keys** (`shared-ui.*`, `extensions.*`) that exist
  only in `apps/nuxeo-ui/public/i18n/en.json`. Neither library ships an `i18n/` directory and
  `libs/platform/ng-package.json` packages no catalogue, so someone installing
  `@nuxeo/satori-platform/ui` gets templates asking for keys nothing supplies.

  Adding `@ngx-translate/core` as a peer dependency made the pipe resolvable; it did not make the
  STRINGS available, and those are two different problems that look like one.

  Closing it needs per-library catalogues, a loader that merges them with the host's, a documented
  loader path, and a gate asserting every key a library references is in a catalogue that library
  ships. That is an architectural change and belongs in its own pull request — this page already
  required per-library catalogues, so the requirement is not new, only unmet.

  **Partly closed, 29 Sep 2026: English travels with the package.** `PLATFORM_EN_TRANSLATIONS` in
  `@nuxeo/satori-platform/ui` is the English for the 299 keys the package's entry points reference,
  generated from `en.json` by `tools/i18n/platform-english.mjs`. A host opts in with
  `providePlatformEnglishFallback()`, a missing-translation handler that answers only keys its own
  catalogues lack and can hand anything else to the host's existing handler. `nuxeo-ui` does not opt
  in, so its behaviour is unchanged. `checkPlatformEnglishFallback` fails when the copy differs
  from `en.json`, lacks a key the package references, or keeps one it no longer does. Translations
  into other languages, through a package catalogue of its own in Crowdin, remain open as NXSAT-296.

- **Dialog text — 48 strings, now keyed and gated.** `title`, `message` and `confirmLabel` on
  `ConfirmDialogData` and the `data:` of a `MatDialog.open(...)` were English literals across 13
  production files, concentrated in `trash.component.ts` (9), `document-detail.ts` (7) and
  `trash-confirm.utils.ts` (7).

  **Why it needed a new gate rather than a wider old one.** `checkNoHardcodedUiText` is repo-wide
  but reads templates, and this text is built in TypeScript.
  `checkNoHardcodedDescriptorText` reads TypeScript but excludes `title` deliberately — that field
  names a Nuxeo document property as often as UI chrome, and `browse.service.ts` builds a synthetic
  document with `title: 'Root'` that must not be flagged. Widening it was tried here and a selftest
  control refused it, correctly.

  `checkNoHardcodedDialogText` is anchored on SCOPE instead: inside a dialog's data object `title`
  and `message` are unambiguously prose, so it can be strict about fields the descriptor check must
  leave alone. It is repo-wide, because all 48 predate any diff and a diff-scoped version would have
  certified them by never looking. Six controls, including the `title: 'Root'` false positive.

  Two of the 48 were worse than untranslated: `trash-confirm.utils.ts` built its messages by
  interpolation — `Move "${title}" to trash?` and `Delete ${count} selected document(s)?`. The `(s)`
  suffix assumes a language pluralises by appending one letter. Both are parameterised keys now, and
  the singular case is its own key rather than a suffix.

### Separate stories, not part of either ticket

9. **A language picker** (NXSAT-294). `availableLanguages` is validated, unit-tested and read only
   by the config parser, so a deployment selects its language through `defaultLanguage`.
   adf-core ships `LanguagePickerComponent`.
10. **`LOCALE_ID` — CLOSED 2026-09-22.** Locale _data_ is registered for `fr` and `de` (and for `ja`, `nl`, `th`, `zh` since NXSAT-293), adf-core's
    formatting locale follows the configuration, and `LOCALE_ID` is now **provided** from it too,
    in `provide-app-config.ts`. Both consumers share `resolveFormattingLocale()`, so Angular's
    formatting locale and adf-core's cannot diverge. Before that provider existed, anything
    reading Angular's locale — every `DatePipe`, `DecimalPipe`, `CurrencyPipe` and
    `inject(LOCALE_ID)` — got the built-in `en-US` regardless of configuration. Covered by
    `LOCALE_ID provider` in `provide-app-config.spec.ts`; deleting the provider turns four tests
    red. See "Locale-aware date formatting" above.
11. **RTL** — DS-2277. Satori needs 4–6 weeks of its own work before an app can start, and the
    target should be the "good enough" level from its spectrum, agreed explicitly.
12. **Pluralisation — the deferral has expired, and the convention is now two keys.** This entry
    said "no ICU usage anywhere; defer until a real plural string appears". Real plural strings
    appeared during NXSAT-284: **21 complete singular/plural pairs** exist, measured with

    ```bash
    node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>\
      typeof v==='object'?f(v,p?p+'.'+k:k):[[p?p+'.'+k:k]]); \
      const k=f(require('./apps/nuxeo-ui/public/i18n/en.json')).map(([x])=>x); \
      const one=new Set(k.filter(x=>x.endsWith('-one')).map(x=>x.slice(0,-4))); \
      console.log([...one].filter(x=>k.includes(x+'-many')).length)"
    ```

    They are **not** ICU. Each is a `*-one` / `*-many` pair chosen by a branch at the call site:

    ```ts
    translate.instant(count === 1 ? 'common.count.result-one' : 'common.count.result-many', {
      count,
    });
    ```

    That was a deliberate choice over adding `ngx-translate-messageformat-compiler`, and the reason
    to know it: an `(s)` suffix assumes a language pluralises by appending one letter, which most do
    not, so the suffix had to go either way — and two keys remove it without a new dependency.

    **The limit is real and worth stating.** Two forms cover English, French and German. Polish has
    three and Arabic six, so a locale with more than two plural forms cannot be expressed this way
    and will need the messageformat compiler. `checkCatalogueValuesAreRenderable` rejects a new
    `(s)`, and every pair is currently complete — no `-one` without its `-many` — but nothing yet
    enforces that pairing, which is the gap to close when a third form is needed.

    `hxpRelativeTime` is the exception that already handles all of this: it uses
    `Intl.RelativeTimeFormat`, which ships every locale's plural rules in the browser, so there is
    nothing to translate and nothing to mistranslate.

13. `GET /nuxeo/api/v1/group/Administrator` **404s on every adf-hx drawer open** because
    `Administrator` is a user, not a group. Unrelated to i18n, currently suppressed in the
    evidence capture with a comment saying so, and it deserves its own ticket.
14. The Nuxeo platform's [Crowdin Integration page](https://hyland.atlassian.net/wiki/spaces/NuxEng/pages/3148546309)
    **publishes a live Crowdin API token in plaintext**, against the HXP standard's explicit MUST.
    Belongs to `nuxeo-lts`, so hand it off — but rotate it before we add a second token.

---

## If you only remember four things

1. **The machinery is done and has been since Phase 1.** Everything that looks unfinished is
   content, and content was descoped from Beta on 21 August.
2. **That GA-sized work has been done.** This point used to read "4 of 92 templates use the
   translate pipe, 1350 template strings and 257 descriptor strings remain" — the measurement
   taken before NXSAT-284 ran. Measured 2026-09-21: **86 of 103** templates use the pipe, **1653**
   catalogue keys with **1654** context entries, and **191** descriptors carry a `labelKey`.

   Do not quote these from here. Two of the three numbers in the table above were stale when this
   correction was written, because six commits had added keys since anyone re-measured, and my
   first pass at this paragraph copied them from the pull request description rather than counting.
   A prose summary of a moving count goes stale silently and is believed anyway — the commands are
   in the row below the table.

3. **The French screenshot proves the mechanism, not a localised product.** Say that when you
   show it, before someone else points at the English nav — and note the nav is English for a
   structural reason, not because it was skipped: those labels are descriptors, not templates.
4. **Never hand-edit a non-English catalogue.** Crowdin owns them and overwrites edits on the
   next pull. And never change the meaning of an existing key — change the key, because
   `update_without_changes` will otherwise keep the old translation and it will be wrong in every
   locale.
