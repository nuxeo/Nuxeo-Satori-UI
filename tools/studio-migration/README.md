# Studio migration

Phase M0 of the migration in
[docs/business-apps/studio-migration.md](../../docs/business-apps/studio-migration.md). It reads a
Studio Designer package written for Web UI and accounts for everything in it, converts the little
that can already be checked without a server, and runs the verification harness over the result.

```bash
npx tsx tools/studio-migration/src/cli.ts inventory <package.zip> [--json]
npx tsx tools/studio-migration/src/cli.ts convert <package.zip> <new-directory>
npx tsx tools/studio-migration/src/cli.ts check <package.zip> <conversion-directory> [--json]
npx tsx tools/studio-migration/src/cli.ts mutate <conversion-directory> <mutation> <new-directory>
npx tsx tools/studio-migration/src/cli.ts mutate --list
```

- `inventory` says what the package holds, what each part becomes and what someone has to decide.
- `convert` writes the M0 conversion and its report.
- `check` runs the harness on a conversion.
- `mutate` writes a deliberately broken copy of a conversion, for the harness to refuse.

**Exit codes:**

- **0:** done, and for `check`, no check failed.
- **1:** a check failed, or something could not be read or written; the reason is printed.
- **2:** the command was wrong.

`convert` and `mutate` write only into a new or empty directory, so they never write over
anything.

## The phase 0 demo

Step 4 of phase 0's demo: run the harness on a deliberately broken conversion of a Studio package,
and watch it fail and say why.

```bash
npx tsx tools/studio-migration/src/cli.ts convert sample.zip /tmp/demo/conversion
npx tsx tools/studio-migration/src/cli.ts check sample.zip /tmp/demo/conversion
npx tsx tools/studio-migration/src/cli.ts mutate /tmp/demo/conversion wrong-primary-token /tmp/demo/broken
npx tsx tools/studio-migration/src/cli.ts check sample.zip /tmp/demo/broken
```

On the sample package:

- **The first `check`:** checks 1 (nothing dropped) and 4 (labels) pass. Check 8 (theme) finds
  two colours of the brand below WCAG 2.1 AA on its own page background: its blue at a contrast
  of 4.43, and its error red at 4.17.
- **The broken copy:** check 8 also names the primary colour moved to the wrong token.
- **Every run:** the verdict is "not ready", with the reasons. Seven checks have not run, 75
  constructs wait for a later phase, and 102 reported items have no owner.

## What it does with a package

A customer's package is untrusted input, so the tool reads it as data:

- It reads the archive in memory and writes no file. An entry's name therefore cannot place
  anything on disk, and nothing in the package is ever run.
- The zip reader handles stored and deflated entries. It refuses, with the reason:
  - encryption, ZIP64 and archives split into parts;
  - absolute names and names that climb with `..`;
  - a name used twice;
  - a checksum or a declared size that does not match the data;
  - archives past the limits on entries, total size and compression ratio.
- HTML and XML are parsed with jsdom, which runs no script and loads nothing unless asked, and
  this tool never asks.

Section 2 of the migration document describes what a package holds. Given one, the tool:

1. **Reads the package:** `package.xml` must declare a `studio` package, and the bundle is the JAR
   that `install.xml` installs.
2. **Gives every file a kind:**
   - **Layouts and screens:** document layouts, search forms and results, slot contributions,
     custom code, the dashboard, themes.
   - **Model and translations:** model contributions and schemas, translations.
   - **Other files:** images, Studio's own `.metadata` records.
   - **Anything else is `unrecognised`.** It is listed, never skipped.
3. **Reads each kind:**
   - each layout's type, mode and bound fields;
   - each search screen's provider, columns and views;
   - each slot contribution's slot and elements, including any operation button that runs no
     operation;
   - the dashboard's cards, marking a card only when its whole markup repeats another's;
   - each theme's custom properties, Polymer mixins included;
   - each language's translation keys;
   - every script in those files, by the shape of its code. The shape keeps the code's
     tokens, drops comments and spacing, and replaces literals with placeholders. Only then can
     Studio's templates be told from customer code: two layouts that differ only in names share a
     shape, and a single added method changes it.

   A file that cannot be read is recorded as a problem, and the run carries on.

4. **Holds the result against the catalogue** in `catalogue/`:
   - [`slots.json`](catalogue/slots.json): each Web UI slot and the app slot or Layer 0 key it
     becomes.
   - [`elements.json`](catalogue/elements.json): what each element becomes.
   - [`theme-tokens.json`](catalogue/theme-tokens.json): the `--mat-sys-*` token each theme
     property sets, or why it sets none.
   - [`scripts.json`](catalogue/scripts.json): the shapes of the scripts Studio generates, and of
     the stock Web UI home it copies in.

   Each entry is `automatic`, `agent-proposes` or `reported`. Lookups read the catalogue's own
   entries only, so a slot a package names `constructor` is not found on `Object.prototype`.

5. **Lists the decisions**, everything a person must settle before a migration can be ready:
   - what the catalogue does not know, which is never a pass;
   - what it reports, and what it leaves for an agent to propose;
   - scripts that are not Studio's, and custom bundles with code;
   - theme properties that set no token;
   - files of no known kind, and files that could not be read;
   - the mistakes the sample showed real projects make: a button with no operation, a repeated
     card, a field bound twice.

## The catalogue

- **Slots.** The 23 slots the reference server's Web UI (2025.21) declares, plus
  `COLLECTION_ACTIONS`, which Web UI's own files contribute to without declaring it.
- **Elements.** The 27 elements of the sample, and two more that the migration document's widget
  table names.
- **Theme tokens.** Only clear one-to-one colour roles are mapped. Every other property is
  reported with a reason, because a migration keeps no custom CSS. In the sample, 8 of its 105
  properties are mapped.
- **Scripts.** The four kinds the sample holds:
  - Studio's document layout, search form and search results. The results' sort options are
    configuration, so their number does not change the shape.
  - Web UI's stock home.
- **Checked when it loads.** The run stops on any of these:
  - a slot sent nowhere;
  - a token that is not a Material colour role, or two properties setting one token;
  - a property both mapped and reported;
  - a script with no shape.
- **Checked against the extension reference.** A test compares the app slots it knows with the
  table in [docs/extension-reference.md](../../docs/extension-reference.md), so the two cannot
  drift apart. That file is among the test target's inputs, so an edit to it reruns the test
  rather than replaying a cached pass.

The catalogue grows with every package that arrives. Widget names are left out on purpose:
layout version 2 defines the widget registry, in phase 1.

## The conversion M0 writes

M0 converts only what the harness can already check without a server: the translations, and the
theme properties that map to a token. A conversion directory holds:

- `report.json`, in the provisional format `studio-migration-report/m0`:
  - the package, and its bundle;
  - the Studio project's branch, commit and build time, from the bundle's manifest;
  - the converter, and its version;
  - every construct of the package, with an outcome.
- `labels/<locale>.json`: the translations, language by language.
- `themes/<name>.json`: the tokens each theme sets, with `var()` references resolved. A value that
  refers to a property the theme does not set is reported instead.
- `themes/<name>/<file>`: each theme's assets, copied unchanged.

Every construct of the package is in the report once, with one of these outcomes:

| Outcome     | Meaning                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `converted` | Done, with where it went                                                                           |
| `proposed`  | An agent proposes it, and a person accepts it                                                      |
| `reported`  | It does not migrate, with why                                                                      |
| `generated` | Studio's own packaging, records and templates                                                      |
| `server`    | It stays on the server in the Studio package, and the new app reads it                             |
| `pending`   | A later phase converts it, and the note says which: layouts and screens in M1, customer code in M3 |

Layouts, search screens, slot contributions and dashboard cards are `pending` in M0, except the
mistakes, which are `reported`.

## The harness

The ten checks of the migration document, section 6, in order:

- **Run in M0, because they need no server:**
  - **1, nothing dropped.** Every construct is in the report exactly once, with a valid outcome,
    and with a reason where the outcome needs one, and nothing is invented. Coverage is 100%. The
    two counts of the package agree:
    - the inventory parses the package;
    - [`second-count.ts`](src/second-count.ts) counts the same constructs from the raw text with
      patterns, sharing no code with the parser.

    A parser that misses something would otherwise go unnoticed, because the converter and the
    harness read the same parse.

  - **4, labels.** Every translation is in its language's file, word for word, and nothing else
    is.
  - **8, theme.** Each mapped property sets its token to its own resolved value. Nothing sets a
    token that no property gives. The theme's files come across byte for byte. Text tokens over
    the backgrounds the theme sets reach WCAG 2.1 AA's 4.5 contrast.
- **Not run yet.** The other seven say "not run", with the reason and the phase that brings
  them, and none counts as a pass.

**Readiness.** A migration is ready only when all ten pass, nothing is pending, nothing proposed
waits for a decision, and every reported item has an owner. So an M0 run is never ready, and it
lists what stands in the way.

**Negative controls.** [`src/mutations.ts`](src/mutations.ts) holds the controls of section 7 for
the checks that run. Each breaks one thing and names the check that must then fail. The tests
apply every one, and `mutate` applies one to a copy:

| Mutation              | Check | Breaks                                             |
| --------------------- | ----- | -------------------------------------------------- |
| `drop-translation`    | 4     | Drops one translation from one language            |
| `change-translation`  | 4     | Changes the words of one translation               |
| `wrong-primary-token` | 8     | Maps the theme's primary colour to the wrong token |
| `invent-token`        | 8     | Sets a token that no property sets                 |
| `drop-asset`          | 8     | Leaves out one of a theme's files                  |
| `change-asset`        | 8     | Changes one byte of one of a theme's files         |
| `drop-report-entry`   | 1     | Drops a layout from the report without a word      |
| `invent-report-entry` | 1     | Lists a layout the package does not have           |
| `unexplained-report`  | 1     | Reports something without saying why               |

## Tests

```bash
npx nx run-many -t lint,typecheck,test -p @nuxeo-satori/studio-migration
```

- **The test package is made up.** Customer packages stay out of this public repository
  (decision J), so the tests use "Acme-Claims", built in `src/testing/`. It has the real format,
  plus traps for the parser: a contribution and a card inside comments, a repeated card, a mixin,
  and a second language.
- **Every refusal is seen failing.** Each refusal and catalogue rule has a negative control: an
  input broken in one way that must fail.
- **Removing a guard turns a test red.** This was checked by mutation: undoing any one of these
  makes a test fail.
  - In the reader: the `..` guard, the checksum check, the entry limit, and the check that the
    central directory holds no more entries than its end record declares.
  - In the inventory: the unrecognised kind, the marking of repeated cards, comparing whole
    cards, and recording scripts.
  - In the catalogue: the app-slot check, and own-property lookups.
  - In the harness, for each of these, a test fails when it is removed:
    - the comparison of the two counts;
    - finding a dropped construct, an invented one, and one without a reason;
    - the comparison of translation texts;
    - the contrast check, and refusing an invented token;
    - comparing assets byte for byte;
    - the readiness rule.

    The asset comparison at first survived its removal. No control changed an asset's bytes, only
    removed one, so `change-asset` was added.

  - Elsewhere: string-aware comment stripping in the theme, and listing reported and proposed
    items as decisions.
- **The two counts were seen disagreeing for real.** On the sample, a viewer element writes
  `role="widget"` twice. The parser keeps one attribute; the first second count counted two
  fields. A field is an element, so the second count now counts tags marked as widgets, and a
  test covers that case.
- **The typecheck target has been seen failing.** It is this project's own, because neither
  `spec-typecheck.mjs` nor any other gate type-checks `tools/`, and it failed on a planted type
  error.

## Not done yet

- **The other seven checks:**
  - 2 needs layout version 2 and the M1 converter;
  - 3, 5, 6 and 7 need the migration server;
  - 9 needs plugins, in M3;
  - 10 needs the package pipeline's schemas.
- **Owners for reported items, and accepting proposals:** the report has an `owner` field and
  the verdict counts what lacks one, but no command sets owners yet.
- **Contrast against the base palette:** a pair is checked only when the theme sets both tokens.
  A pair the theme sets only half of is not checked yet. Checking it needs the compiled palette's
  values, which M1's theme conversion reads.
- **Real packages beyond the one sample:** the catalogue grows with each one that arrives.
- **Conversion itself:** layouts, screens, slots and the dashboard, in M1, phase 4.
