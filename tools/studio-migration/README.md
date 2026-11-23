# Studio migration

Phases M0 and M1 of the migration in
[docs/business-apps/studio-migration.md](../../docs/business-apps/studio-migration.md). It reads a
Studio Designer package written for Web UI and accounts for everything in it. It converts the
declarative track (M1) into an app definition the package pipeline's validator accepts, and runs the
verification harness over the result.

```bash
npx tsx tools/studio-migration/src/cli.ts inventory <package.zip> [--json]
npx tsx tools/studio-migration/src/cli.ts convert <package.zip> <new-directory> [--allow-list <file>]
npx tsx tools/studio-migration/src/cli.ts check <package.zip> <conversion-directory> [--json] [--allow-list <file>]
npx tsx tools/studio-migration/src/cli.ts mutate <conversion-directory> <mutation> <new-directory>
npx tsx tools/studio-migration/src/cli.ts mutate --list
```

- `inventory` says what the package holds, what each part becomes and what someone has to decide.
- `convert` writes the M1 conversion and its report.
- `check` runs the harness on a conversion.
- `mutate` writes a deliberately broken copy of a conversion, for the harness to refuse.
- `--allow-list` names the deployment's operations, `{ "operations": [...] }`, as the app
  definition's validator reads them (decision 3). A button becomes an action only when its
  operation is on it. `check` uses the list the conversion was made with, unless it is given one.

**Exit codes:**

- **0:** done, and for `check`, no check failed. A check that ran only in part has not failed.
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

On the sample package, with M1:

- **The first `check`:**
  - **Pass:** 1 (nothing dropped), 2 (fields), 4 (labels), 5 (conditions: the sample has none, and
    the conversion invents none) and 10 (package).
  - **Partial:**
    - 3, model: six names rest on the platform's own model, Dublin Core's five fields and the page
      provider `domain_documents`;
    - 6, what people see: the values, and four labels that are Web UI's own translation keys;
    - 7, what the server is asked: the recorded requests and their counts.
  - **Fail:** check 8 (theme) finds two colours of the brand below WCAG 2.1 AA on its own page
    background: its blue at a contrast of 4.43, and its error red at 4.17.
- **The broken copy:** check 8 also names the primary colour moved to the wrong token.
- **Every run:** the verdict is "not ready", with the reasons:
  - check 8 failed, three checks ran in part, and check 9 waits for M3;
  - 5 constructs wait for a later phase, and one proposal waits for a person;
  - 133 reported items have no owner.

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

## The conversion M1 writes

M1 is the declarative track of section 4: a parser and the catalogue, so the same package always
gives the same conversion. A conversion directory holds:

- `report.json`, in the provisional format `studio-migration-report/m1`:
  - the package, and its bundle;
  - the Studio project's branch, commit and build time, from the bundle's manifest;
  - the converter, and its version;
  - the allow-list it was converted with;
  - every construct of the package, with an outcome, and for a field or column the property.
- `app/`: an app definition ([app-definition-v2.md](../../docs/business-apps/app-definition-v2.md)),
  which harness check 10 holds to the package pipeline's validator:
  - `app.json`: the app's id, from the package's name; its version; the platform range from the
    platform's own version up to 1.0.0; the group `members`, because Web UI shows a Studio
    project's screens to everyone; and the theme its `THEMES` contribution names.
  - `layouts/<Type>/<mode>.layout.json`, one per document layout (below).
  - `queues/<id>.json`: a search screen's results as `queues/<search folder>.json`, and a dashboard
    card's list as `queues/home-<n>-<provider>.json`.
  - `actions.json`: each operation button whose operation is on the allow-list.
  - `labels/<locale>.json`: the translations, language by language, in version 2's labels file.
- `themes/<name>.json`: the tokens each theme sets, with `var()` references resolved, for the
  bootstrap configuration (Layer 0). A value that refers to a property the theme does not set is
  reported instead.
- `themes/<name>/<file>`: each theme's assets, copied unchanged.

**Layouts.** Each Web UI layout becomes the file of its type, from its `@doctype`, and its mode:

- **`view`** is written in layout version 2, one card of fields, each with the widget
  [layout-v2.md, section 10](../../docs/business-apps/layout-v2.md#10-what-the-studio-migration-writes)
  gives its element. The element-to-widget table is the catalogue's
  ([`elements.json`](catalogue/elements.json)), and the catalogue is held to the validator's widget
  registry when it loads. A view that only shows the document viewer gets no file: the app's
  document page shows the preview, as Web UI's did.
- **`metadata`, `edit` and `create`** are written in version 1, because the app still refuses
  version 2 in those modes and shows the generated layout instead (layout-v2.md, section 11). Each
  field keeps its label and, in a form, its required flag:
  - **The widget.** Version 1 cannot name a widget: the schema type picks it. A field whose element
    asks for one version 1 cannot show, such as a user picker, is still written, so that its value
    stays in the form, and it is reported.
  - **What the panel shows itself.** In `metadata`, Title, Description, Nature, Subjects and
    Coverage are the Properties panel's own rows, so the file leaves them out. A metadata layout of
    those alone becomes an empty file, which shows nothing more, where no file would show every
    schema of the type.
- **`import`** has no place in the app, whose import step reads no layout. It is reported, with its
  fields.
- **Not written:**
  - a field bound a second time is reported, and kept once;
  - a field that sits in a condition (`nuxeo-filter`, `dom-if`) is pending: M2 converts the
    condition, and until then the field is not shown to everyone;
  - an element the catalogue does not know as a field is reported.

**Search screens** become queues over the same page provider:

- **Kept:** the columns, with their widgets, the sort the results open with, and the name of the
  menu entry that opens them.
- **Reported:** a queue has no search form. The form and its fields are reported, because the
  queue lists what the page provider returns with the predicates left empty, as Web UI does before
  anyone searches. A grid or justified-grid view is reported too: a queue is a table.

**The dashboard.** A card's list becomes a queue: its page provider, its query parameters, its page
size and its columns. The card itself is pending, naming its queue: its place on the home is phase
1's `home.json`, which is not in the app definition yet, so the app-definition validator would
refuse the file as out of place.

- **Pending too:** the tasks card and the recently viewed card.
- **Proposed:** a card fed by an operation, such as the favourites one, which an agent proposes a
  page provider for.
- **Reported:** a card that repeats another.

**Slot contributions:**

- **Actions.** An operation button on a document's page or over a selection becomes an action, with
  its operation, its literal parameters, its icon (Polymer's `icons` set shares Material's names)
  and its order. It needs the operation on the allow-list; without one, the button is reported.
- **Pending:** the left menu and its pages wait for phase 1's `navigation.json`, and the note names
  the queue they open. Tabs wait for M2.
- **Conditions.** A contribution that sits in a condition is pending, whatever the allow-list says.

**The theme.** M0's tokens and files, and its name in `app.json`'s `branding.theme`.

**An image.** One the model names, such as the sample's type icon, stays on the server. Any other
is reported: `app.json`'s branding takes a logo and a favicon only.

Every construct of the package is in the report once, with one of these outcomes:

| Outcome     | Meaning                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `converted` | Done, with where it went                                                                  |
| `proposed`  | An agent proposes it, and a person accepts it                                             |
| `reported`  | It does not migrate, with why                                                             |
| `generated` | Studio's own packaging, records and templates                                             |
| `server`    | It stays on the server in the Studio package, and the new app reads it                    |
| `pending`   | A later phase converts it, and the note says which: conditions and tabs in M2, code in M3 |

A `reported` construct may still have been written, as a field version 1 cannot show as Web UI
does is: its `to` then says where.

## The harness

The ten checks of the migration document, section 6, in order. A check that found nothing in what
it could run, but could not run whole, is `partial`: it is not a pass, and it blocks readiness as a
check that did not run does.

- **Run in full, because they need no server:**
  - **1, nothing dropped.** Every construct is in the report exactly once, with a valid outcome,
    and with a reason where the outcome needs one, and nothing is invented. Coverage is 100%. The
    two counts of the package agree:
    - the inventory parses the package;
    - [`second-count.ts`](src/second-count.ts) counts the same constructs from the raw text with
      patterns, sharing no code with the parser.

    A parser that misses something would otherwise go unnoticed, because the converter and the
    harness read the same parse.

  - **2, fields.** Each converted layout shows the fields its Web UI layout binds: each once, in
    the same mode, with the same required flag and the expected widget. Each list shows its
    columns, in order, with theirs. What Web UI shows is read from the package. The report only
    excuses a missing field it reports or leaves pending, with its reason. A field that sits in a
    condition is check 5's.
  - **4, labels.** Every translation is in its language's labels file, word for word, and nothing
    else is. One the labels file refuses is reported.
  - **8, theme.** Each mapped property sets its token to its own resolved value. Nothing sets a
    token that no property gives. The theme's files come across byte for byte. Text tokens over
    the backgrounds the theme sets reach WCAG 2.1 AA's 4.5 contrast.
  - **10, package.** Every file under `app/` is placed and validated by
    `libs/shared/app-definition`, as the package pipeline does (`scripts/app-package.mjs`, step
    2):
    - its schema;
    - its IDs against the registries;
    - the operations against the allow-list;
    - `app.json`'s range against the platform's version.

    A file out of place is refused. The validator leaves version 1 layouts to the reader in
    `libs/shared/document-layouts`, which does not export it, so the pipeline checks nothing in
    them. This check holds them to version 1's documented contract
    ([extension-reference.md](../../docs/extension-reference.md), section 9b) instead.
- **Run in part: what needs no server runs, and the rest needs the migration server:**
  - **3, model.** Every field, type, vocabulary and page provider the conversion names exists, and
    every widget shows its property's type. The package's own model is read from its contributions
    and XSDs ([`model.ts`](src/model.ts)), and checked in full: a field the package's own schema
    lacks fails. What rests on the platform's model is listed: Dublin Core, and stock types,
    vocabularies and page providers. `/config/types`, `/config/schemas`, the directories and the
    page provider definitions confirm it.
  - **5, conditions.** No rule is invented: M1 converts no condition, so any rule in the package
    fails, a free JavaScript one slipped in among them. Nothing Web UI shows under a condition is
    shown to everyone. The truth tables wait for M2, in Web UI on the migration server. A package
    with no condition passes: there is nothing for a table to decide.
  - **6, what people see.** Each field, column and list is named as Web UI names it, the app's
    label worked out as the app does: the `label`, the `labelKey`, `layout.field.<xpath>`, the name
    made readable. A label that rests on a catalogue the package does not hold is listed. The values
    need both apps on the same records.
  - **7, what the server is asked.** Each list asks the same page provider with the same parameters,
    opening sort and page size. Each action runs the same operation with the same parameters, on
    the record or a selection, as Web UI does. Nothing asks for anything the package does not. The
    recorded requests and their result counts need the server.
- **Not run:** 9, plugins, which M3 brings.

**Readiness.** A migration is ready only when all ten pass, nothing is pending, nothing proposed
waits for a decision, and every reported item has an owner. So an M1 run is never ready, and it
lists what stands in the way.

**Negative controls.** [`src/mutations.ts`](src/mutations.ts) holds the controls of section 7 for
the checks that run. Each breaks one thing and names the check that must then fail. The tests
apply every one to the made-up package, and `mutate` applies one to a copy:

| Mutation               | Check | Breaks                                                          |
| ---------------------- | ----- | --------------------------------------------------------------- |
| `drop-translation`     | 4     | Drops one translation from one language                         |
| `change-translation`   | 4     | Changes the words of one translation                            |
| `wrong-primary-token`  | 8     | Maps the theme's primary colour to the wrong token              |
| `invent-token`         | 8     | Sets a token that no property sets                              |
| `drop-asset`           | 8     | Leaves out one of a theme's files                               |
| `change-asset`         | 8     | Changes one byte of one of a theme's files                      |
| `drop-report-entry`    | 1     | Drops a layout from the report without a word                   |
| `invent-report-entry`  | 1     | Lists a layout the package does not have                        |
| `unexplained-report`   | 1     | Reports something without saying why                            |
| `drop-field`           | 2     | Drops a field from a converted layout                           |
| `date-to-text`         | 2     | Turns a date widget into text, in a layout or a list            |
| `drop-required`        | 2     | Makes a required field of a form optional                       |
| `rename-field`         | 3     | Names a field the package's own schema does not have            |
| `slip-free-javascript` | 5     | Slips a free JavaScript condition into the configuration        |
| `widen-to-everyone`    | 5     | Shows a field Web UI shows only under a condition to every user |
| `change-label`         | 6     | Changes the label of a converted field                          |
| `wrong-page-provider`  | 7     | Points a list at a different page provider                      |
| `change-parameter`     | 7     | Changes one parameter of a list or an action                    |
| `bind-other-operation` | 7     | Binds a button to a different operation                         |
| `unregistered-widget`  | 10    | Names a widget the platform does not have                       |

**On the sample**, every control was applied to its conversion with `mutate` and checked: the 18
that find something to break each fail their check, with a finding of their own. The other two have
nothing to break there, and say so: `widen-to-everyone`, because the sample has no condition, and
`bind-other-operation`, because its one button runs no operation. The tests apply both to the
made-up package, which has them.

Section 7's "invert a rule" waits for M2, which converts the first rules: until then there is no
rule to invert, and any rule at all fails check 5.

## Tests

```bash
npx nx run-many -t lint,typecheck,test -p @nuxeo-satori/studio-migration
```

- **The test package is made up.** Customer packages stay out of this public repository
  (decision J), so the tests use "Acme-Claims", built in `src/testing/`. It has the real format,
  plus traps for the parser: a contribution and a card inside comments, a repeated card, a mixin,
  and a second language. For M1 it adds section 7's synthetic corpus, what the sample lacks:
  - a field and a button under a `nuxeo-filter`;
  - a date in a view layout, and a user picker in an edit form;
  - an operation button with parameters;
  - a dashboard list with a query parameter and a page size;
  - schemas with typed fields.
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
  - **In M1, 35 guards**, each broken in turn by a script that runs the suite and restores it, and
    each seen turning it red:
    - **In the converter:** the repeat kept once; a field under a condition left pending; the
      panel's rows left out; a widget version 1 cannot show reported; a button under a condition
      left pending; the allow-list; a grid view reported; a labels key refused; safe file names.
    - **In check 2:** a missing field; the widget; the required flag; a field Web UI does not show;
      the column order; a widget named in version 1.
    - **In check 3:** a field the schema lacks; the widget against the property's type; the type's
      schemas.
    - **In check 5:** an invented rule; a field or an action widened to everyone.
    - **In check 6:** the label comparison.
    - **In check 7:** the page provider, a list's parameters and sort, the operation and its
      parameters, an invented list, an invented action.
    - **In check 10:** a file out of place; the validator; a field listed twice in a version 1
      section.
    - **Elsewhere:** `partial` never read as a pass; the inventory finding conditions; the second
      count counting them.

    The first round found three that did not turn the suite red. No test sent a repeated field
    through the conversion. No test changed a list's parameters: `change-parameter` changes an
    action's first. The third was a mistake in the round itself. Each now has its test.
- **The two counts were seen disagreeing for real.** On the sample, a viewer element writes
  `role="widget"` twice. The parser keeps one attribute; the first second count counted two
  fields. A field is an element, so the second count now counts tags marked as widgets, and a
  test covers that case.
- **The typecheck target has been seen failing.** It is this project's own, because neither
  `spec-typecheck.mjs` nor any other gate type-checks `tools/`, and it failed on a planted type
  error.
- **The module boundary has been seen refusing.** The tool is tagged `type:tool`, which may use
  shared code and the core, and nothing may depend on it. An import of a feature library, planted
  in the tool, failed lint.

## Not done yet

- **The server halves of checks 3, 5, 6 and 7** need the migration lab server, with the Studio
  package installed and Web UI beside the new app (development plan, phase 4). Neither local server
  has it, and no code reads a server yet: those halves say they did not run.
- **Check 9** needs plugins, in M3.
- **Conditions, tabs, task forms and layout blocks** are M2's. Until then a field, button or card
  under a condition is pending, and tabs are pending.
- **The home and the menu** are phase 1's `home.json` and `navigation.json`, which are not in the
  app definition yet. The dashboard's cards and the drawer's entries are pending until they are;
  the queues they would name are written already.
- **A search form.** A queue has none, so a search screen's form and its fields are reported.
- **Web UI's own label keys.** A dashboard card's heading and its columns are Web UI's translation
  keys, such as `home.latestDocumentsEdited`. The queue names them as `labelKey`, which the app's
  catalogue does not have, and check 6 lists them. Their text needs Web UI's catalogue, read on the
  migration server, or an agent's proposal.
- **Version 1 in the package pipeline.** The app-definition validator, and so the pipeline, checks
  nothing in a version 1 layout. Check 10 holds them to the documented contract, but the pipeline
  itself does not, until version 1's reader is shared from `libs/shared/document-layouts`.
- **Owners for reported items, and accepting proposals:** the report has an `owner` field and
  the verdict counts what lacks one, but no command sets owners yet.
- **Contrast against the base palette:** a pair is checked only when the theme sets both tokens.
  A pair the theme sets only half of is not checked yet. Checking it needs the compiled palette's
  values, which are Sass and not JSON.
- **Waiting on real packages.** Only the sample is in hand, and it has no condition, no custom code,
  no task layout, no tab, no second language and no button that runs an operation. Real packages
  will show:
  - the elements, slots and widgets they use that the catalogue does not know yet;
  - Studio's forms of condition, for M2 and check 5;
  - operation buttons with parameters, for actions and check 7;
  - dashboards beyond Web UI's stock home;
  - whether Studio annotates every results layout as the sample does;
  - the scripts Studio generates in other versions, whose shapes the catalogue must learn.

  The development plan's phase 4 is done when three real packages migrate with every automatic
  check green.

- **The app the sample's view files are for.** The sample's two types extend File, and the app
  keeps a file record's own preview rather than drawing a record page beside it (layout-v2.md,
  section 11). So their view files load but are not drawn yet.
