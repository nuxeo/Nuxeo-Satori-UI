# Studio migration

Phases M0, M1 and the conditions of M2 of the migration in
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
  Check 10 then runs only in part when there are actions: the conversion's record of what was
  allowed is not the deployment's word for it.

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
  - 2 constructs wait for a later phase, and one proposal waits for a person;
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
  - `home.json`: a card for each dashboard card whose list is a queue, naming it.
  - `navigation.json`: an entry for each left-menu entry that opens a search screen, naming its
    queue.
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
  - a field that sits in a condition (`nuxeo-filter`, `dom-if`) is written with the condition's
    rule only in `view` (see **Conditions**, below). In version 1 it is pending, as version 1 has
    no rules; where its condition does not convert it is reported, and where the rule is proposed
    it waits for a person;
  - an element the catalogue does not know as a field is reported;
  - a field that binds a property another field already shows is reported, and the property is
    kept once. A field under a condition, or of an unknown element, shows nothing, so a later
    field binding the same property still shows it;
  - a label bound to the page other than as `[[i18n('key')]]` is not written as text: the field
    has no label of its own, and check 6 lists the binding.
- **A second layout of the same type and mode** is reported: the first is the one written, and the
  checks hold only that one to the file.

**Search screens** become queues over the same page provider:

- **Kept:** the columns, with their widgets, the sort the results open with, and the name of the
  menu entry that opens them.
- **Reported:** a queue has no search form. The form and its fields are reported, because the
  queue lists what the page provider returns with the predicates left empty, as Web UI does before
  anyone searches. A grid or justified-grid view is reported too: a queue is a table.
- **Reported, too:** a column under a condition, which the queue leaves out, and a list whose
  table sits in one, which gets no queue. M2 converts no condition there, so a person decides
  each, and neither is shown to everyone meanwhile.

**The dashboard.** A card's list becomes a queue: its page provider, its query parameters, its page
size when it is one a queue takes (1 to 100; the card's note says when it is not) and its columns.
The card becomes a card of `home.json`, with the card's heading, naming the queue
([app-definition-v2.md](../../docs/business-apps/app-definition-v2.md), section 10).

- **Pending:** the tasks card and the recently viewed card: `home.json` has no card for either
  yet.
- **Proposed:** a card fed by an operation, such as the favourites one, which an agent proposes a
  page provider for.
- **Reported:** a card that repeats another.
- **Left out:** a column under a condition its table is not in, which the card's note names. M2
  converts no condition on a list's column, and it is not shown to everyone meanwhile.

**Slot contributions:**

- **Actions.** An operation button on a document's page or over a selection becomes an action, with
  its operation, its literal parameters, its icon (Polymer's `icons` set shares Material's names)
  and its order. It needs the operation on the allow-list; without one, the button is reported. A
  button whose parameters are bound to the page is reported: a written action has no page to read
  them from. So is a button whose `input` is not what its action runs on, `[[document]]` on the
  toolbar or `[[selectedItems]]` over a selection: one on `[[document.parentRef]]`, a literal id or
  nothing would run its operation on another document.
- **One owner per action and per queue.** Each action id, and each queue path, belongs to the first
  contribution or list that becomes one at all, in the package's order. A later one is reported,
  and the checks hold each action and queue to its owner only.
- **The left menu.** An entry (`DRAWER_ITEMS`) whose page (`DRAWER_PAGES`, paired by name) holds a
  search screen becomes an entry of `navigation.json` (section 9), with its label, icon and order,
  opening the screen's queue. The page is converted to that queue. An entry that opens anything
  else is pending: `navigation.json` opens a queue or a platform page, and the mapping agent
  proposes which. `navigation.json` holds only the package's own entries; Web UI's stock ones are
  the app's.
- **Pending:** tabs wait for M2.
- **Conditions.** A button under a condition becomes an action whose `visibleWhen` is the
  condition's rule. A bulk action whose condition reads the open record is reported. A menu entry
  under a condition carries its rule too, where the rule reads only the user.

**Conditions (M2).** A Web UI condition becomes the registered rule that decides exactly as it
does ([`conditions.ts`](src/conditions.ts)).

- **What each side decides is read from its own code.** Web UI's side comes from nuxeo-elements'
  `nuxeo-filter.js` and `nuxeo-filters-behavior.js`. The app's side comes from the registered rules
  in `libs/shared/extensions` and `libs/shared/nuxeo-client`.
- **A `nuxeo-filter`'s tests** convert one by one, joined by `core.every`. A nested filter joins its
  parent's the same way ([`guards.ts`](src/guards.ts)):
  - `type`, `facet`, `state` and `group` become `isType`, `hasFacet`, `inState` and `inGroup`;
  - `permission` converts only when its values are exactly one rule's permissions: `Write,
WriteProperties` becomes `canWrite`, `Remove` becomes `canRemove`, `AddChildren` becomes
    `canAddChildren`, and `WriteSecurity, Everything` becomes `canManagePermissions`.
- **Reported, never guessed:**
  - `path` and `schema`, which no registered rule tests;
  - a single permission no rule matches exactly, such as `Write`, which `canWrite` would widen to
    `WriteProperties`;
  - a filter given another document than the open record;
  - a test of spacing alone, which never passes in Web UI;
  - a group test given no user, or given a user its file does not hold, which never passes either.
    A bundle holds one, from the model Web UI stamps slot contributions with. A document layout is
    given only its document, and the stock home nothing, so there `user` is set only by what
    writes it, a `<nuxeo-connection user="{{user}}">`. Declaring the property sets nothing;
  - a condition whose truth table would run more than 200,000 rows, which could not hold its rule
    to it.
- **JavaScript in a known pattern is proposed**, with its rule in the report for a person to
  accept. What it guards is written only once they do. JavaScript sits in two places:
  - a `dom-if`'s `if`, which Polymer binds as one path or one call, in `[[…]]` or `{{…}}`, with
    nothing else in the attribute. One call of a filter function on `document` or `user`, such as
    `[[!hasFacet(document, 'Folderish')]]`, is a known pattern. Text around the binding, even
    spacing, makes it a compound binding, a string; `&&`, `||` or a method of a value is no
    binding at all, and the text stays. Either way `if` is a non-empty string, so Web UI always
    shows what the `dom-if` holds, and that is reported. So is a path, such as
    `[[document.isFolderish]]`, and a `dom-if` with no `if`, which shows nothing;
  - a filter's `expression`, which runs with `this` the filter: `this.` calls of its functions,
    `document.facets.indexOf('X') !== -1` and `document.facets.includes('X')`, each optionally
    negated, joined by `&&` or by `||` but not both. A call without `this.` throws, so the filter
    never passes, and that is reported. So is `!` before `indexOf`, which JavaScript applies to
    the index before the comparison, so the expression is always true.

  `hasPermission` is a known pattern only for a permission one rule holds alone: `Remove` or
  `AddChildren`. Any other JavaScript is reported.

- **What a condition guards** is what it hides:
  - a field, where it names its property, in an attribute or in text. A condition around a hint
    inside the field guards nothing. A field naming its property in two places under conditions
    side by side is reported. So is one naming it both in a condition and outside every one, as
    `hidden$="[[!document.properties.x]]"` does: which place shows the value, and which only reads
    it, cannot be told from the markup;
  - an action, by its operation button, and a menu entry, by its menu icon;
  - a home card, by its page provider and its table, which its list needs.
- **Where a rule travels:**
  - the `visibleWhen` of a view field, an action, a home card and its queue, and a menu entry;
  - on the home and the menu, no record is open, so only a rule on the user travels;
  - not to a version 1 field, which waits for the app to draw version 2 forms;
  - not to a list's column, which is left out, or a search screen's table, which is reported.
- **A condition is `converted` only where its rule was written**, and the report says where.
  Otherwise it is pending, and each thing it guards says why.

**The theme.** M0's tokens and files, and its name in `app.json`'s `branding.theme`.

**An image.** One the model names, such as the sample's type icon, stays on the server. Any other
is reported: `app.json`'s branding takes a logo and a favicon only.

Every construct of the package is in the report once, with one of these outcomes:

| Outcome     | Meaning                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `converted` | Done, with where it went                                                                                                                           |
| `proposed`  | An agent proposes it, and a person accepts it                                                                                                      |
| `reported`  | It does not migrate, with why                                                                                                                      |
| `generated` | Studio's own packaging, records and templates                                                                                                      |
| `server`    | It stays on the server in the Studio package, and the new app reads it                                                                             |
| `pending`   | A later phase converts it, and the note says which: tabs in M2, a version 1 field under a condition once the app draws version 2 forms, code in M3 |

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

    A file out of place is refused. Without `--allow-list`, actions are held to the list the
    conversion recorded, and the check is partial.

    The validator leaves version 1 layouts to the reader in `libs/shared/document-layouts`, which
    does not export it, so the pipeline checks nothing in them. This check holds them to version
    1's documented contract ([extension-reference.md](../../docs/extension-reference.md), section
    9b) instead.
- **Run in part: what needs no server runs, and the rest needs the migration server:**
  - **3, model.** Every field, type, vocabulary and page provider the conversion names exists, and
    every widget shows its property's type. The package's own model is read from its contributions
    and XSDs ([`model.ts`](src/model.ts)), and checked in full: a field the package's own schema
    lacks fails. What rests on the platform's model is listed: Dublin Core, and stock types,
    vocabularies and page providers. `/config/types`, `/config/schemas`, the directories and the
    page provider definitions confirm it.
  - **5, conditions.**
    - Every rule in the package sits on something a condition of the package guards, worked out
      from the inventory.
    - Each rule decides as Web UI's reading of those conditions does on every row of their truth
      table. The rows are:
      - each value tested, and one value that is not;
      - every subset of the facets, permissions and groups named;
      - the rule's own values.
    - So an inverted rule, a widened one, a rule on the wrong field and a free JavaScript one
      slipped in all fail. A rule written differently that decides the same passes.
    - Each condition's own rule is held to the same table.
    - Nothing Web UI shows under a condition is shown to everyone: no field, action, home card,
      queue or menu entry loses its rule.
    - The tables prove the mapping against the two sources as written. Evaluating each original
      in Web UI itself, on the migration server, has not run. A package with no condition passes,
      because there is nothing for a table to decide.
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

| Mutation                   | Check | Breaks                                                                |
| -------------------------- | ----- | --------------------------------------------------------------------- |
| `drop-translation`         | 4     | Drops one translation from one language                               |
| `change-translation`       | 4     | Changes the words of one translation                                  |
| `wrong-primary-token`      | 8     | Maps the theme's primary colour to the wrong token                    |
| `invent-token`             | 8     | Sets a token that no property sets                                    |
| `drop-asset`               | 8     | Leaves out one of a theme's files                                     |
| `change-asset`             | 8     | Changes one byte of one of a theme's files                            |
| `drop-report-entry`        | 1     | Drops a layout from the report without a word                         |
| `invent-report-entry`      | 1     | Lists a layout the package does not have                              |
| `unexplained-report`       | 1     | Reports something without saying why                                  |
| `drop-field`               | 2     | Drops a field from a converted layout                                 |
| `date-to-text`             | 2     | Turns a date widget into text, in a layout or a list                  |
| `drop-required`            | 2     | Makes a required field of a form optional                             |
| `rename-field`             | 3     | Names a field the package's own schema does not have                  |
| `slip-free-javascript`     | 5     | Slips a free JavaScript condition into the configuration              |
| `widen-to-everyone`        | 5     | Shows a field Web UI shows only under a condition to every user       |
| `widen-column-to-everyone` | 5     | Shows a list column Web UI shows only under a condition to every user |
| `invert-rule`              | 5     | Inverts the rule a converted condition became                         |
| `drop-rule`                | 5     | Drops the rule of something Web UI shows only under a condition       |
| `change-label`             | 6     | Changes the label of a converted field                                |
| `wrong-page-provider`      | 7     | Points a list at a different page provider                            |
| `change-parameter`         | 7     | Changes one parameter of a list or an action                          |
| `bind-other-operation`     | 7     | Binds a button to a different operation                               |
| `wrong-home-queue`         | 7     | Points a card of the home at another queue                            |
| `drop-menu-entry`          | 7     | Drops an entry of the menu                                            |
| `unregistered-widget`      | 10    | Names a widget the platform does not have                             |

**On the sample**, every one of the 25 controls was applied to its conversion with `mutate` and
checked. The 20 that find something to break each fail their check, with a finding of their own,
`wrong-home-queue` and `drop-menu-entry` among them. The other five have nothing to break there,
and say so: `widen-to-everyone`, `widen-column-to-everyone`, `invert-rule` and `drop-rule`,
because the sample has no condition, and `bind-other-operation`, because its one button runs no
operation. The tests apply all five to the made-up package, which has them.

Section 7's "invert a rule" is `invert-rule`. It and `drop-rule` take the first rule the
conversion carries, on a layout field, an action, a home card, a menu entry or a queue. The tests
also drop and invert each rule of the made-up package in turn, and check 5 fails for every one.

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
  - **In M1, 36 guards**, each broken in turn by a script that runs the suite and restores it, and
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
      section; partial on the conversion's own allow-list.
    - **Elsewhere:** `partial` never read as a pass; the inventory finding conditions; the second
      count counting them.

    The first round found three that did not turn the suite red. No test sent a repeated field
    through the conversion. No test changed a list's parameters: `change-parameter` changes an
    action's first. The third was a mistake in the round itself. Each now has its test.

  - **An independent review** then found twelve ways to drop, widen or misread something that
    every check still passed. Examples: a property shown to everyone, dropped because an earlier
    field bound it under a condition; a queue written for a card under a condition; a bound label
    copied as text. Each is fixed, with a test in `checks-m1.spec.ts` that was run against the code
    before the fix and failed there. A second round confirmed the twelve fixed and found two more,
    fixed the same way: a card whose queue a search screen took was held to that screen's queue,
    and two files' unnamed buttons shared an action id.
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
- **The rest of M2: task forms, tabs and layout blocks.** Tabs are pending. Task forms target
  app-definition-v2.md, section 6, and need Studio's task-layout file format read from Web UI's
  own sources first.
- **Conditions that do not travel yet:** on a version 1 field, on a list's column and on a search
  screen's table. The server half of check 5 needs the migration server.
- **The home and the menu, as the app draws them.** The conversion writes `home.json` and
  `navigation.json`, which the validator checks, but the app draws neither of what M1 writes yet:
  - it does not read `navigation.json` (app-definition-v2.md, section 9);
  - it leaves out a home card that is only a link to a queue, until phase 1's queue page exists
    (`HOME_QUEUE_LINK` in `libs/shared/home`). Every card M1 writes is one, because Web UI's
    dashboard shows a list where `home.json` would show a figure, and M1 invents no figure.

  The tasks and recently viewed cards wait for card kinds of their own.

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
