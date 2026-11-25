# Studio migration

Phases M0, M1 and M2 of the migration in
[docs/business-apps/studio-migration.md](../../docs/business-apps/studio-migration.md). It reads a
Studio Designer package written for Web UI and accounts for everything in it. It converts the
declarative track (M1, and M2's conditions, task forms, tabs and layout blocks) into an app
definition the package pipeline's validator accepts, and runs the verification harness over the
result. It prints the report a person approves, with every reported item's owner and decision.

**A customer migrating their own package** runs one command, `migrate`, and follows
[the guide](../../docs/business-apps/studio-migration-guide.md), which is written for them:

```bash
npm run studio-migration -- migrate <package.zip> --out <new-directory> [--allow-list <file>] [--from <earlier run>]
```

The commands it runs, one by one:

```bash
npx tsx tools/studio-migration/src/cli.ts inventory <package.zip> [--json]
npx tsx tools/studio-migration/src/cli.ts convert <package.zip> <new-directory> [--allow-list <file>]
npx tsx tools/studio-migration/src/cli.ts check <package.zip> <conversion-directory> [--json] [--allow-list <file>]
npx tsx tools/studio-migration/src/cli.ts mutate <conversion-directory> <mutation> <new-directory>
npx tsx tools/studio-migration/src/cli.ts mutate --list
npx tsx tools/studio-migration/src/cli.ts decisions <package.zip> <conversion-directory> [--from <decisions.json>]
npx tsx tools/studio-migration/src/cli.ts report <package.zip> <conversion-directory> [--json] [--allow-list <file>]
npx tsx tools/studio-migration/src/cli.ts migrate <package.zip> --out <new-directory> [--allow-list <file>] [--from <earlier run>]
npx tsx tools/studio-migration/src/cli.ts lab <document>... --out <new-directory> [--app <url>] [--web-ui <url>] [--nuxeo <url>] [--package <package.zip> --conversion <conversion-directory>] [--control <control>]
```

`npm run studio-migration -- <command> …` runs the same, from the repository's root.

- `inventory` says what the package holds, what each part becomes and what someone has to decide.
- `convert` writes the M1 conversion and its report.
- `check` runs the harness on a conversion.
- `mutate` writes a deliberately broken copy of a conversion, for the harness to refuse.
- `decisions` writes the conversion's `decisions.json`, for people to say who owns each reported
  item and what they decided. `--from` carries the decisions of an earlier file that still hold.
- `report` prints the report of the migration document's section 8 (below, **The report**).
- `migrate` runs `inventory`, `convert`, `check`, `report` and `decisions` on one package, in that
  order, keeps what each prints in a file of `--out`, and says what to do next (below, **The
  guided migration**).
- `lab` opens documents in Web UI and in the new app on a real server, compares the requests each
  sends, and runs the server halves it can (below, **Lab mode**). It is the only command that
  talks to a server.
- `--allow-list` names the deployment's operations, `{ "operations": [...] }`, as the app
  definition's validator reads them (decision 3). A button becomes an action only when its
  operation is on it. `check` and `report` use the list the conversion was made with, unless they
  are given one.
  Check 10 then runs only in part when there are actions: the conversion's record of what was
  allowed is not the deployment's word for it.

**Exit codes:**

- **0:** done, and for `check` and `migrate`, no check failed. A check that ran only in part has
  not failed. `report` exits 0 once it has printed the report, whatever the report says.
- **1:** a check failed, or something could not be read or written; the reason is printed.
- **2:** the command was wrong; for `lab`, also its environment (below, **Lab mode**).

`convert` and `mutate` write only into a new or empty directory, `decisions` only a
`decisions.json` the conversion does not hold yet, and `migrate` and `lab` only into a new or
empty `--out`, so none of them writes over anything.

## The guided migration

`migrate <package.zip> --out <new-directory>` ([`src/migrate.ts`](src/migrate.ts)) is phase 10's
first piece of self-service migration (migration M4, in the
[migration document](../../docs/business-apps/studio-migration.md), section 10): a customer runs
it on their own package, and [the guide](../../docs/business-apps/studio-migration-guide.md) walks
them through what it writes.

- **The steps are the commands.** Each is `main` itself, given the arguments a person would type,
  and what it prints goes into a file of `--out`:

  | Step                              | Command                                | In `--out`                                   |
  | --------------------------------- | -------------------------------------- | -------------------------------------------- |
  | 1. The inventory                  | `inventory <package>`                  | `inventory.txt`                              |
  | 2. The conversion                 | `convert <package> <out>/conversion`   | `conversion/`, `conversion.txt`              |
  | 3. The checks that need no server | `check <package> <out>/conversion`     | `check.txt`                                  |
  | 4. The report                     | `report <package> <out>/conversion`    | `report.txt`                                 |
  | 5. The decisions to fill in       | `decisions <package> <out>/conversion` | `conversion/decisions.json`, `decisions.txt` |

  `--allow-list` goes to `convert`, `check` and `report`, and `<out>` is given in full, so that
  every path the run prints opens from any folder. So each file is what the command prints by
  hand into the same paths, byte for byte, and the tests hold them to it.

- **With `--from`,** an earlier run, a conversion directory or a `decisions.json`, the decisions
  step carries the decisions that still hold (`decisions --from`), and runs third, so that the
  checks and the report count them: inventory, conversion, decisions, checks, report. A first run
  keeps the decisions last: a scaffold of blank entries changes nothing the checks or the report
  print.
- **It stops at the first step that refuses,** says why and what to do in plain words, and runs
  nothing after it. A check that fails is not a refusal: the harness ran and found something, which
  the report shows, so the run carries on to the report and the decisions, and exits 1. It knows
  the harness ran from `check`'s own result, which `main` hands it (`CliIo.checked`), not from what
  `check` prints or its exit code.
- **It never writes over anything.** Before writing anything it refuses an `--out` that is a file
  or holds anything, a package it cannot read, an `--allow-list` that is no allow-list, and a
  `--from` it cannot read. Each file it writes is written only where none is (`wx`); `convert`
  and `decisions` keep their own refusals.
- **It only reads the package,** once: every step is given the same bytes.
- **It says which checks still need the migration lab server,** and why: each of checks 3, 5, 6
  and 7 whose server half did not run, with what that half adds and what this run could not
  settle, and check 9, which waits for M3. Check 10 is never among them: `check` is given the
  allow-list `convert` was, and without one the conversion makes no action.

**On the made-up packages**, Acme-Claims with and without M2's corpus, every file `migrate` writes
is byte-identical to the commands run by hand into the same paths:

- in the tests, each package with and without the allow-list, and with `--from` an earlier run of
  it whose decisions are filled in;
- in a shell, each package with and without the allow-list, and each of those four again with
  `--from`: the commands run by hand with `tsx`, against `npm run studio-migration -- migrate`,
  compared with `diff -r`. The packages' bytes were the same after every run.

**Negative controls**, each in [`src/migrate.spec.ts`](src/migrate.spec.ts):

- **A package that is not a Studio package:** an `addon` package, a zip with no `package.xml`, and
  a file that is no zip. The inventory refuses each, and nothing is written.
- **A step that refuses:** a theme folder whose name cannot be a file name on every system, which
  the conversion refuses, so the checks, the report and the decisions do not run; and `--from`
  holding another build's decisions, which the decisions step refuses before the checks.
- **A re-run that would overwrite:** `migrate` into the `--out` of an earlier run, its decisions
  filled in, which refuses before writing anything and leaves the run byte for byte as it was;
  and a file appearing where a step's output goes during the run, which is not written over.

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
   - **Layouts and screens:** document layouts, workflow task layouts, layout blocks, search
     forms and results, slot contributions, custom code, the dashboard, themes.
   - **Model and translations:** model contributions and schemas, translations.
   - **Other files:** images, Studio's own `.metadata` records.
   - **Anything else is `unrecognised`.** It is listed, never skipped.
3. **Reads each kind:**
   - each layout's type, mode and bound fields, and the layout blocks it uses;
   - each task layout's workflow and step, and the task variables its fields bind;
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
  - `tasks/<workflow>.<step>.layout.json`, one per workflow task layout (M2, below).
  - `home.json`: a card for each dashboard card whose list is a queue, naming it.
  - `navigation.json`: an entry for each left-menu entry that opens a search screen, naming its
    queue.
  - `actions.json`: each operation button whose operation is on the allow-list.
  - `labels/<locale>.json`: the translations, language by language, in version 2's labels file.
- `themes/<name>.json`: the tokens each theme sets, with `var()` references resolved, for the
  bootstrap configuration (Layer 0). A value that refers to a property the theme does not set is
  reported instead.
- `themes/<name>/<file>`: each theme's assets, copied unchanged.

Beside them, `decisions.json` holds who owns each reported item and what they decided. People
write it, with the `decisions` command, and no conversion does (below, **The report**).

**Layouts.** Each Web UI layout becomes the file of its type, from its `@doctype`, and its mode:

- **`view`** is written in layout version 2: a card of the layout's own fields, and one for each
  layout block it uses (M2, below), each field with the widget
  [layout-v2.md, section 10](../../docs/business-apps/layout-v2.md#10-what-the-studio-migration-writes)
  gives its element. The element-to-widget table is the catalogue's
  ([`elements.json`](catalogue/elements.json)), and the catalogue is held to the validator's widget
  registry when it loads. A view that only shows the document viewer gets no file: the app's
  document page shows the preview, as Web UI's did.
- **`metadata`, `edit` and `create`** are written in version 1. The app refuses version 2 in
  `metadata` mode and shows the generated panel instead; it draws `edit` and `create` files of
  version 2 since phase 2, which the converter does not write yet (layout-v2.md, sections 10 and
  11). Each field keeps its label and, in a form, its required flag:
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

- **As Web UI's slots register them** (nuxeo-elements' `nuxeo-slots.js`, replayed step by step
  in [`slot-registry.ts`](src/slot-registry.ts)), for actions, the left menu, the theme and tabs
  alike:
  - a contribution registers into each slot its `slot` names, split at commas as written;
  - in a slot, a contribution of an earlier one's `name`, at the same or a higher `priority`,
    replaces it in its place when it holds a template, and otherwise changes its `disabled`,
    `order` and `priority`, and its slots; at a lower priority it is ignored. Every contribution
    is registered, one with no template too, so one that comes first at a higher priority makes a
    later one of its name ignored;
  - after each registration the slot sorts by `order`, 0 when left out, equals keeping their
    places;
  - what shows is a contribution with a template, not disabled. The converter writes it at its
    order, `order: 0` where Web UI's is left out, and in Web UI's order; it reports each other
    one as left out, and one a change moves to other slots for a person to map. One with no
    template and no earlier one of its name changes one of Web UI's own, and is reported for a
    person to decide;
  - `priority` and `order` are read as Polymer reads a Number, `2.5`, `NaN` and `Infinity`
    included, and compared as Web UI compares them. An order that is not whole is left out of the
    file, which takes whole numbers, and the action or entry is reported: the app shows one with no
    order after every ordered one;
  - a contribution to several slots, `slot="A,B"`, takes part in each one's registration, so it can
    hide or replace a button of A, but becomes nothing itself: it is a slot the catalogue does not
    know, and is reported.

  A button's and a menu icon's label are translated by Web UI as a key
  (`nuxeo-operation-button`, `nuxeo-menu-icon`: `i18n(label)`), as a tab's is: a key the package
  translates becomes `labelKey`, and any other is written as it is, which is what Web UI shows.

  The custom bundle's contributions are read too, before the bundle's, as Studio's bundle imports
  it first: a project's hand-written change, such as hiding a button, goes there.

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
- **Tabs** become tabs of a type's view file (M2, below).
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
    it, cannot be told from the markup. So is one holding a condition that binds something or
    holds an element, but where it does not name its property: it may show the value another way,
    as a widget's `xpath` does;
  - an action, by its operation button, and a menu entry, by its menu icon and its page's search
    form;
  - a home card, by its page provider and its table, which its list needs.
- **Where a rule travels:**
  - the `visibleWhen` of a view field, an action, a home card and its queue, and a menu entry;
  - in M2, of a tab, of a layout block's card, and of a task form's field;
  - on the home and the menu, no record is open, so only a rule on the user travels;
  - not to a version 1 field, which waits for the converter to write version 2 forms;
  - not to a list's column, which is left out, or a search screen's table, which is reported.
- **A condition is `converted` only where its rule was written**, and the report says where.
  Otherwise it is pending, and each thing it guards says why.

**Task forms (M2).** A workflow task layout becomes the task form of its step
([app-definition-v2.md](../../docs/business-apps/app-definition-v2.md), section 6), read from Web
UI's own task page (`nuxeo-document-task.js`) and its stock layouts:

- **Where it is.** Web UI loads a step's layout from
  `ui/workflow/<workflow>/nuxeo-<step>-layout.html`, both names in lower case. The app reads
  `tasks/<workflowModelName>.<nodeName>.layout.json`, with the names as the server writes them, so
  their case comes from the package: the variables schemas Nuxeo names after a workflow and a step,
  `var_<workflow>` and `var_<step>` (read on the reference server: `var_SerialDocumentReview`,
  `var_Task38e`), and the workflows it imports (`routeModelImporter`). A name the package does not
  give, or gives twice in different cases, is reported, and so is the layout.
- **What it holds.** A field bound to `task.variables.<name>` becomes `var:<name>`, with its
  widget, label and required flag, as an edit form's field. A step whose layout shows no field gets
  a form with no card, as Web UI shows none; with no file the app would show its own form of the
  step's variables.
- **Read-only.** Web UI writes back only what an input binds two ways: `{{path}}` or
  `{{path::event}}` on an element that edits, not a `nuxeo-date`, `nuxeo-user-tag` or `nuxeo-tag`,
  and not one marked `readonly` or `disabled`. A computed or negated `{{…}}`, a `[[…]]` binding
  and text are one way. So in a task form, a variable Web UI does not edit is written
  `readOnlyWhen: "core.true"`: the app neither edits nor sends what Web UI never changes. Version
  1 cannot make a field read-only, so in an edit or create layout such a field is written editable
  and reported.
- **The document.** Web UI's task page fetches the task with its first target whole
  (`nuxeo-app.js`, `fetch-task: targetDocumentIds`, with every schema): on the reference server it
  holds the document's type, state, facets and properties, but no permissions, since no enricher
  asks for them. So a field or a layout block bound to the document becomes the record's property,
  which the app's task form shows read-only; a type, facet or state test converts as anywhere; and
  a permission test, which never passes there, is reported, in the task layout and in a block it
  uses. A record's field Web UI requires is written without the flag, since a task form requires
  only the step's variables, and reported. A group test converts where the layout writes the user,
  as everywhere.
- **The buttons** are the step's own, from the workflow on the server: Web UI's task page and the
  app's task panel both draw `taskInfo.taskActions`, so a form has none to write.

**Layout blocks (M2).** A layout block is a Polymer element of the package that layouts use by
its name, as Studio Designer's layout blocks are. No package in hand shows where Studio writes
them, so a block is known by what it is rather than by its folder: a Web UI file of no other kind
that defines one `dom-module` with `Nuxeo.LayoutBehavior`.

- **Where it is used, it becomes a card.** Web UI shows a block's fields where it sits among the
  layout's own, so the block is a card of its own fields there, in version 1 a section, between
  the cards of the layout's own fields before and after it: `fields`, the block's name,
  `fields-2`. Each use, and each of the block's fields there, is a construct of the file that
  uses it, so a block used twice shows its fields twice, each decided where it shows.
- **A block under a condition** gives its card the condition's rule in version 2. In version 1 it
  is pending, as a field under a condition is. A field under a condition inside the block carries
  its own rule.
- **Reported:** a block given no document (`document="[[document]]"`), whose fields show nothing
  in Web UI; a block inside another block, since a card holds no card; a block in a search screen,
  the dashboard or a slot contribution that is not a tab's page; a block no layout uses.

**Tabs (M2).** A tab of Web UI's document page is a `nuxeo-page-item` contributed to
`DOCUMENT_VIEWS_ITEMS` and the page of the same `name` contributed to `DOCUMENT_VIEWS_PAGES`
(`nuxeo-browser.js`, `nuxeo-web-ui-bundle.html`). It becomes a tab of layout version 2
([layout-v2.md](../../docs/business-apps/layout-v2.md), section 2):

- **In each type it shows on.** A layout file is a type's own, so the tab goes into the view file
  of each type every `type` test of its conditions names. The record page's own cards become the
  first tab, `view`, and the tabs follow in Web UI's order, an order left out being 0, as Web UI's
  slot has it. Web UI opens the document page on its View tab, at order 10, and the record page
  opens on its first tab, so a tab Web UI puts before View comes after it, and its report entry
  says so. A tab's cards are named after it, `<tab>.<card>`, because a card's id is unique in its
  file.
- **As Web UI's slots register them** (`nuxeo-slots.js`): a disabled contribution shows nothing,
  and is reported; a later contribution of the same name, at the same or a higher priority,
  replaces an earlier one when it holds a template and otherwise changes its `disabled`, `order`
  and `priority`; one at a lower priority is ignored. A contribution with no template and no
  earlier one of its name changes one of Web UI's own, such as hiding its Permissions tab, and is
  reported for a person to decide.
- **What it holds** is its page's layout block, as one card.
- **Its rule** is the item's and the page's conditions together, through M2's conditions, as its
  `visibleWhen`.
- **Its label.** Web UI translates the item's label as a key, and shows the key itself when no
  catalogue holds it. A key the package translates becomes `labelKey`; any other is written as it
  is, and check 6 lists it as resting on Web UI's catalogue.
- **Reported, never guessed:** a tab whose conditions test no type, so it shows on every type; a
  condition that does not convert; an item with no page, or more than one; a page no item opens; a
  page that is not a layout block of the package; a tab named as one of Web UI's own; a tab on a
  type the package writes no view file of, or whose view layout shows only the document's
  preview. A tab on several types, some of which have no view file, is written for the others and
  reported, with where it went.

**The theme.** M0's tokens and files, and its name in `app.json`'s `branding.theme`.

**An image.** One the model names, such as the sample's type icon, stays on the server. Any other
is reported: `app.json`'s branding takes a logo and a favicon only.

Every construct of the package is in the report once, with one of these outcomes:

| Outcome     | Meaning                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `converted` | Done, with where it went                                                                                                                      |
| `proposed`  | An agent proposes it, and a person accepts it                                                                                                 |
| `reported`  | It does not migrate, with why                                                                                                                 |
| `generated` | Studio's own packaging, records and templates                                                                                                 |
| `server`    | It stays on the server in the Studio package, and the new app reads it                                                                        |
| `pending`   | A later phase converts it, and the note says which: a version 1 field under a condition once the converter writes version 2 forms, code in M3 |

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

    The report must also be of the package given: its name and version, and Studio's commit and
    build time from the bundle's manifest. A construct's id is its place in its file, so a report
    of another build can name the same ids for other constructs. Two builds of one name and
    version whose manifests record neither commit nor build time are told apart here only by
    their constructs; `decisions.json` tells them apart by their bundle's SHA-256 too.

  - **2, fields.** Each converted layout shows the fields its Web UI layout binds: each once, in
    the same mode, with the same required flag and the expected widget. M2 adds the fields of the
    layout blocks each layout uses; each tab of a view file, which shows its block's fields; and
    each task form, which shows its task layout's variables. A tab or a task form no Web UI one
    gives fails. Each list shows its columns, in order, with theirs. What Web UI shows is read
    from the package. The report only excuses a missing field it reports or leaves pending, with
    its reason. A field that sits in a condition, its own or its block's, is check 5's.
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
- **Run in part: what needs no server runs, and the rest needs the migration server.** Lab mode
  (below) runs check 3's server half on a server, and those of checks 6 and 7 on the pages of the
  documents it is given; checks 5, 6 and 7 need the package installed there:
  - **3, model.** Every field, type, vocabulary and page provider the conversion names exists, and
    every widget shows its property's type. A task form's variable is held to its step's and its
    workflow's variables schemas, when the package holds them. The package's own model is read from its contributions
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
    - A rule is read 256 levels deep (`MAX_NESTING`, as the validator reads it). One nested
      deeper, in a conversion edited by hand, fails as a rule the table cannot read, rather than
      the check overflowing its stack.
    - Each condition's own rule is held to the same table.
    - Nothing Web UI shows under a condition is shown to everyone: no field, action, home card,
      queue, menu entry, layout block's card or tab loses its rule, and no field of a block under a
      condition moves out of its card.
    - A rule of a layout or a task form is found by what it sits on: a tab by its id, a block's
      card by its id, and a field by its property in its card.
    - The tables prove the mapping against the two sources as written. Evaluating each original
      in Web UI itself, on the migration server, has not run. A package with no condition passes,
      because there is nothing for a table to decide.
  - **6, what people see.** Each action and menu entry is at the order Web UI's slot gives it,
    a later contribution of its name included, and two of one order are listed in the places Web
    UI shows them in. Each action is named as its button is, a menu entry as its icon is, and a tab
    as its page item is, each translated as Web UI translates it. Each field, column, list and tab is named as Web
    UI names it, the app's label worked out as the app does: the `label`, the `labelKey`, `layout.field.<xpath>`, the name
    made readable. A label that rests on a catalogue the package does not hold is listed. The values
    need both apps on the same records.
  - **7, what the server is asked.** Each list asks the same page provider with the same parameters,
    opening sort and page size. Each action runs the same operation with the same parameters, on
    the record or a selection, as Web UI does: the contribution Web UI's slot keeps, never a
    disabled, replaced or outranked one. Nothing asks for anything the package does not. The
    recorded requests and their result counts need the server.
- **Not run:** 9, plugins, which M3 brings.

**Readiness.** A migration is ready only when all ten pass, nothing is pending, nothing proposed
waits for a decision, and every reported item has an owner and a decision in `decisions.json`,
with nothing wrong in that file (below, **The report**). Given `--allow-list`, the conversion must
also have been made with that list, since a reported button's reason names the list it was made
with. So an M1 run is never ready, and it lists what stands in the way. An id the report lists
twice is read by its first entry.

**Negative controls.** [`src/mutations.ts`](src/mutations.ts) holds the controls of section 7 for
the checks that run. Each breaks one thing and names the check that must then fail. The tests
apply every one to the made-up package, and `mutate` applies one to a copy:

| Mutation                     | Check | Breaks                                                                |
| ---------------------------- | ----- | --------------------------------------------------------------------- |
| `drop-translation`           | 4     | Drops one translation from one language                               |
| `change-translation`         | 4     | Changes the words of one translation                                  |
| `wrong-primary-token`        | 8     | Maps the theme's primary colour to the wrong token                    |
| `invent-token`               | 8     | Sets a token that no property sets                                    |
| `drop-asset`                 | 8     | Leaves out one of a theme's files                                     |
| `change-asset`               | 8     | Changes one byte of one of a theme's files                            |
| `drop-report-entry`          | 1     | Drops a layout from the report without a word                         |
| `invent-report-entry`        | 1     | Lists a layout the package does not have                              |
| `unexplained-report`         | 1     | Reports something without saying why                                  |
| `other-version`              | 1     | Makes the report one of another version of the package                |
| `drop-field`                 | 2     | Drops a field from a converted layout                                 |
| `date-to-text`               | 2     | Turns a date widget into text, in a layout or a list                  |
| `drop-required`              | 2     | Makes a required field of a form optional                             |
| `rename-field`               | 3     | Names a field the package's own schema does not have                  |
| `slip-free-javascript`       | 5     | Slips a free JavaScript condition into the configuration              |
| `widen-to-everyone`          | 5     | Shows a field Web UI shows only under a condition to every user       |
| `widen-column-to-everyone`   | 5     | Shows a list column Web UI shows only under a condition to every user |
| `invert-rule`                | 5     | Inverts the rule a converted condition became                         |
| `drop-rule`                  | 5     | Drops the rule of something Web UI shows only under a condition       |
| `change-label`               | 6     | Changes the label of a converted field                                |
| `wrong-page-provider`        | 7     | Points a list at a different page provider                            |
| `change-parameter`           | 7     | Changes one parameter of a list or an action                          |
| `bind-other-operation`       | 7     | Binds a button to a different operation                               |
| `wrong-home-queue`           | 7     | Points a card of the home at another queue                            |
| `drop-menu-entry`            | 7     | Drops an entry of the menu                                            |
| `unregistered-widget`        | 10    | Names a widget the platform does not have                             |
| `drop-task-field`            | 2     | Drops a field from a converted task form                              |
| `rename-task-variable`       | 3     | Names a variable the task's step and workflow do not have             |
| `var-in-layout`              | 10    | Puts a task's variable into a document's layout                       |
| `drop-block-card`            | 2     | Drops a layout block's card from a converted layout                   |
| `drop-tab`                   | 2     | Drops a tab from a converted view layout                              |
| `drop-tab-rule`              | 5     | Shows a tab Web UI shows only under a condition to every user         |
| `change-tab-label`           | 6     | Changes the label of a converted tab                                  |
| `make-display-editable`      | 2     | Makes a field Web UI only shows editable in a task form               |
| `drop-block-use-entry`       | 1     | Drops a use of a layout block from the report without a word          |
| `revive-disabled-action`     | 7     | Makes an action of a disabled button                                  |
| `keep-replaced-action`       | 7     | Keeps a button a later one of the same name replaces                  |
| `keep-outranked-action`      | 7     | Keeps a button a higher priority one of the same name outranks        |
| `revive-disabled-menu-entry` | 7     | Makes a menu entry of a disabled one                                  |
| `change-action-order`        | 6     | Moves an action from the order Web UI's slot gives it                 |

The four that write what Web UI leaves out read the package too: `mutate` takes it with
`--package <package.zip>`, and refuses without it.

**On the sample**, every one of the 39 controls of the checks there were then was applied to its conversion with `mutate` and
checked. The 21 that find something to break each fail their check, with a finding of their own,
`wrong-home-queue`, `drop-menu-entry` and M2's `var-in-layout` among them. The other 18 have
nothing to break there, and say so: `widen-to-everyone`, `widen-column-to-everyone`, `invert-rule`
and `drop-rule`, because the sample has no condition; `bind-other-operation`, because its one
button runs no operation; eight of M2's nine, because it has no task layout, tab or layout block;
and the five of the slot registration, because it has no disabled, replaced or outranked
contribution and no action. The slot controls were applied with `mutate` to the made-up package's
conversion, and each failed its check. The tests apply every control to the made-up package with M2's corpus, which has them all,
and each of M2's nine was also applied with `mutate` to that package's conversion and seen failing
its check. The fortieth, `other-version`, came with the report: the tests apply it to the made-up
package, and it was applied with `mutate` to that package's conversion, with and without M2's
corpus, and seen failing check 1.

Section 7's "invert a rule" is `invert-rule`. It and `drop-rule` take the first rule the
conversion carries, on a layout field, a tab, a card, a task form's field, an action, a home card,
a menu entry or a queue. The tests also drop and invert each rule of the made-up package in turn,
M2's corpus included, and check 5 fails for every one.

**The decisions' controls.** Six more, in the same file, break a `decisions.json` filled in against
its report, in one way each: they take a decision's owner or what was decided off, change the
report under a decision, or add an entry that must not be taken. No check fails then: readiness
must show it among what stands in the way, a count risen or a line of its own, which `mutate
--list` shows as `decisions`.
Each needs a decisions file with a decision filled in, and says so when the conversion has none.

| Mutation           | Breaks                                                                                                                        | Readiness then says                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `drop-owner`       | Takes the owner off a reported item's decision                                                                                | 1 reported item has no owner                            |
| `drop-decision`    | Leaves a reported item's owner with nothing decided                                                                           | 1 reported item has an owner but no decision            |
| `stale-decision`   | Changes the reason the report gives for a decided item, as a conversion made again would, with its decisions copied beside it | it was made on another reason than the report gives now |
| `decide-unlisted`  | Decides an item the report does not list                                                                                      | it is not in the report                                 |
| `decide-converted` | Decides an item the report gives as converted                                                                                 | only a reported item takes a decision                   |
| `decide-twice`     | Decides one reported item twice                                                                                               | it is decided 2 times                                   |

The tests apply each to the made-up package with M2's corpus and a decisions file filled in, and
each adds a line of its own to what stands in the way. Each works from a decision readiness takes,
so that it cannot pass by breaking one readiness already leaves aside. Each was also applied with
`mutate` to the made-up package's conversion, with and without M2's corpus, its decisions filled
in, and `check` named it, where the unbroken copy had nothing of the decisions in the way. The
sample is not in this repository, and was not used.

## The report

Section 8 of the migration document describes the report a person approves, and step 5 of phase 4's
demo shows it: 100% of the package accounted for, and every reported item with an owner.

**The decisions** ([`src/decisions.ts`](src/decisions.ts)). `report.json` is the converter's, the
same for the same package every time. What people decide is kept beside it, in `decisions.json`,
which no conversion writes, so that converting the same package again, once the catalogue has
learnt something, loses none of it.

- **For one build of the package.** A file of decisions names the package's name and version,
  Studio's commit and build time from the bundle's manifest, and the SHA-256 of the bundle, and is
  taken only for the package `check` or `report` is given, when all five are the same. A
  construct's id is its place in its file, so another build can give an id to another construct,
  and a decision would land on it. The bundle's SHA-256 tells two builds apart where the manifest
  records neither commit nor build time, as when a project keeps its version.
- **`decisions <package> <conversion>`** writes `decisions.json`, in the provisional format
  `studio-migration-decisions/1`: the build, and an entry for every reported item, in the
  report's order. Each entry copies what it is made on from the report, the item's
  label, property, outcome, where it was written, its reason and its rule, and leaves `owner` and
  `decision` for a person to fill in. It never writes over a `decisions.json` the conversion holds.
- **`--from <earlier decisions.json>`** carries each decision of a file written for an earlier
  conversion of the same build, where the decision still holds for this report. It lists each
  that said something and does not carry, and why; the earlier file is read and never changed, so
  it still holds them. An entry of the earlier file that says nothing is passed over. It refuses
  the decisions of another package, version or Studio build. It says how many entries are left
  to fill in.
- **A decision is taken** only when what it copied still matches the report, whatever the order
  of a rule's keys. One made on another reason, label, property, place or rule was made on
  something else, and is not taken: it is decided again. Nor is one of an item the report does not
  list, or does not report, one listed twice, one holding a key a decision does not take, such as
  a verdict, or one whose owner or decision is not text. An item the report lists twice is its
  first entry's, as everywhere else. A file of another format, of another build, or with no list,
  is taken not at all, and a key of the file other than `format`, `package` and `decisions`, such
  as an approval, is named. Each is a line of what stands in the way.
- **Readiness** then counts the reported items with no owner, and those whose owner says nothing
  decided, as `check` prints them. An owner or a decision of spaces alone is none.
- **Only a reported item takes a decision.** Accepting or rejecting a proposal is not built: the
  converter would have to write what a person accepts, and until it does a proposal waits.

**The report** ([`src/report.ts`](src/report.ts)): `report <package> <conversion>` prints it, and
`--json` gives the same as data. It reads the package, the conversion and its decisions, and writes
nothing.

- **The header:** the package handed in and its version, the platform it targets, its bundle;
  Studio's branch, commit and build time, from its bundle's manifest; the app's id and platform
  range; the converter; the allow-list the harness held the actions to, and whether it is the
  deployment's, given with `--allow-list`, or the one the conversion recorded. Whether the report
  is of that package is check 1's.
- **The summary:** the package's constructs, as the inventory reads them, by kind, with the outcome
  of each one's first entry in the report: how many are converted, proposed, reported and of those
  decided, generated, left on the server, pending, and missing from the report. An entry whose
  outcome is none is counted apart. The coverage is check 1's: the share of the constructs the
  report lists, rounded down to a tenth, so that 99.96% never reads as 100%.
- **What the harness found:** the ten checks, and the verdict with what stands in its way.
- **The decisions needed:** every reported item, with its reason, where it was written, and its
  owner and decision, each or none; what was not taken from `decisions.json`; and every proposal.
  What people and the package wrote is printed on one line each, a line break as `\n`, so that no
  owner's words can print a line of their own, such as an item that looks decided.
- **Each file:** its constructs by outcome, and where those converted went. What the harness
  found is not split by file: its findings name the conversion's files rather than the package's,
  and are given whole, above.

Screenshots and request logs are lab mode's, below, which writes them beside its own report; this
report does not take them in yet. The reviewer's approval is the reviewer's: no command records it.

## Lab mode

Step 4 of phase 4's demo (development plan): Web UI and the new app side by side on the same
documents, with their request logs compared. `lab` ([`src/lab-cli.ts`](src/lab-cli.ts)) is its
first slice, against a real server:

```bash
export NUXEO_USER=<user> NUXEO_PASS=<password>
npm run studio-migration -- lab <document>... --out <new-directory> --app http://localhost:4297/ \
  [--package <package.zip> --conversion <conversion-directory>] [--control <control>]
```

- **What it opens.** Each document, by its id or its path, in Web UI (`--web-ui`, by default
  `<nuxeo>/nuxeo/ui/`, `--nuxeo` being `http://localhost:8080` by default) and in the new app
  (`--app`, by default `http://localhost:4200/`: `npx nx serve nuxeo-ui`, with what it should show
  served by `npm run config:dev`), each in a fresh Chromium context, as the user `NUXEO_USER` and
  `NUXEO_PASS` name. They have no default. Playwright is not a dependency, as for the Beta harness:
  `npm install --no-save @playwright/test`, then `npx playwright install chromium`.
- **What it records**, of each request either app sends to Nuxeo
  ([`src/lab-browser.ts`](src/lab-browser.ts)): its method, path and query; the schemas
  (`properties`, `X-NXproperties`, `X-NXDocumentProperties`), enrichers and fetch headers it asks
  with; and its status. Of the answers: the names of the properties the document's own answer
  holds, a page's result count, and who `/me` and Web UI's sign-in say the requests ran as. Of the
  pages: the document layouts Web UI loaded for the document's type, read by the inventory's own
  reader as a package's are; the layout files the new app loaded for it; and which page the new app
  showed, with the `data-field` of each field on it. Never a credential, and never a value.
- **Read only.** A request either app sends is refused before it leaves the browser, and listed,
  unless it is a `GET`, `HEAD` or `OPTIONS`, or a `POST` of an operation that only reads: Web UI's
  sign-in (`login`), `Repository.Query`, `Repository.PageProvider`, `Directory.SuggestEntries`,
  `Audit.QueryWithPageProvider` and `NuxeoDrive.GetRoots`. Downloads (`@blob`, `@rendition`,
  `@preview`, `@convert`, `nxfile` and the like) are refused too: the server may write them to its
  audit log. From Node it only reads, with `GET`s to the server's origin that follow no redirect.
- **As the same user.** Before anything opens, `/me` must answer as the user, judged by the Beta
  harness's identity guard (`judgeMe`). Web UI is sent the user's `Authorization` on every request
  to the server's origin, and nowhere else. The new app is given the session its sign-in writes,
  as `h.login()` writes it, before its first script runs, and every request it sends to Nuxeo's
  API must carry that header. Each `/me` either app reads, and Web UI's sign-in, must name the
  user; a document where one does not is not compared, and the run exits 2. Under automation, Web
  UI waits for an `automation-ready` event unless `window.automationReady` is set, so lab mode
  sets it.
- **The request-log rule** ([`src/lab.ts`](src/lab.ts)), check 7's server half on a document's
  page. The harness defined none before. For each document:
  1. **The document.** Web UI's page asks for it, with a `GET` by id or by path; the new app's must
     too, and be answered as Web UI was: both read it, or neither.
  2. **Its schemas.** Every schema Web UI asks for it with, `*` being every one, the new app asks
     for too, read as each browser sent the request. The new app's development server adds
     `X-NXproperties: *` to everything it proxies (`apps/nuxeo-ui/proxy.conf.json`), so there it
     receives every schema whatever it asks: only what it asks says what a server would send it.
  3. **Its properties: every property Web UI fetches and shows, the new app fetches and can
     show.** Web UI shows a property when a document layout it loaded for the document binds it in
     a field outside every condition, and fetched it when its answer for the document holds it.
     The new app fetches it when an answer for the document it received holds it, and can show it
     when its page holds a field of it, when a layout file it loaded for the type lists it, as on a
     tab not opened, or when its page draws it itself: the document page's Properties panel, or the
     info panel of Browse, where the new app opens a folder (`DRAWN_BY_THE_PAGE`). That table is a
     copy of those components, which `lab.spec.ts` holds to their source files. A field under a
     condition is listed, not held: whether it shows is the condition's, which check 5 holds.

  Listed side by side, and held to nothing yet: the enrichers each app asks the document with, the
  page providers each asks with their parameters and result counts, the other endpoints, and what
  lab mode refused.

- **The report**, in the harness's format: for each document, checks 6 and 7 on its page, then
  what each app asked; given `--package` and `--conversion`, the server halves of checks 3, 5, 6
  and 7; and the verdict, how many documents differ. `--out`, new or empty, gets `lab.txt`, what
  it prints; `lab.json`, the same with the recordings, as data; and a screenshot of each app on
  each document, for the reviewer. Check 6 on a document is never more than `partial`: the
  screenshots are taken, and the values are not compared yet.
- **The server halves**, given a package and its conversion:
  - **3 runs whole:** the package's own model as `check` holds it, and each name that rests on the
    platform confirmed on the server: a property against `/config/types`, `/config/facets` and
    `/config/schemas`, read with the app definition's `readContentModel`, its widget held to the
    property's type there and a layout's type to its schemas; a type; a vocabulary, at
    `/directory/<name>`; a page provider, by its definition at `/search/pp/<name>`, never a page of
    it; and a task's variable, against its step's and its workflow's variables schemas.
  - **6 and 7 stand on the documents** only when Web UI serves the package's own files byte for
    byte, which it does once the package is installed, and the new app is served the conversion's
    layout files where `config:dev` serves them. Otherwise each says which of the two it needs, and
    how many files are served as the package and the conversion hold them.
  - **5 does not run in lab mode:** evaluating each condition in Web UI needs the package installed
    and test users in and out of each group, which lab mode never creates: it writes nothing. A
    package with no condition passes, as in `check`.
- **Not compared is never a pass.** A document is not compared when Web UI never asked for it, or
  when lab mode could not read a layout either app loaded, or the new app's page: held to less than
  what each showed, the rule could pass where it should not. Its checks say why, and the run
  exits 1.
- **Exit codes:** 0, every document compared, none differs and no check failed; 1, a difference, a
  failed check, a document not compared, or something could not be read or written; 2, the command
  was wrong, or the environment is: the credentials, Playwright, a server that does not answer as
  the user, or a document that could not be compared as the user.

**Its controls**, `--control`, each put into the new app's side alone, in the browser, for the
rule to report:

| Control                           | Breaks                                                                   | The rule must report                           |
| --------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| `withhold-property=<prefix:name>` | Takes the property out of every answer for the document the new app gets | Web UI shows it; the new app does not fetch it |
| `narrow-schemas=<schema,...>`     | Makes the new app ask for the document with those schemas alone          | A schema Web UI asks for that it does not      |

**On the local server**, 25 November 2026: Nuxeo LTS 2025.10.18 in Docker, with Web UI at
`/nuxeo/ui/`, and the new app's development server on port 4297 serving the Payers kit's files; as
the administrator, on a File, a Folder, a Note and a Payers Member:

- **The Folder differs, five times.** Web UI's folder metadata layout, under its Details, shows
  the description, nature, subjects, coverage and expiry date. The new app opens a folder in
  Browse, whose info panel shows none of them. The other three documents do not differ.
- **The Member:** Web UI has no layout for Member, as nothing installed gives it one (both answered
  404), so it shows none of its properties, and the rule holds none.
- **Listed:** on the File, the Note and the Member, Web UI asks for the document with eleven
  enrichers the new app does not, `audit`, `breadcrumb` and `pendingTasks` among them, and the new
  app with two Web UI does not, `acls` and `allowedTransitions`; on the Folder, nine and three.
  Lab mode refused Web UI's `User.GetUserWorkspace`, which creates the user's workspace when there
  is none, and both apps' downloads of the file and of a thumbnail. Nothing was written: none of
  the four documents' audit trails holds an entry from that day, where earlier days' hold
  `download` entries, the kind lab mode refuses to cause.
- **The controls, each seen reported**, on the Note: `withhold-property=dc:description`, as "Web
  UI shows dc:description (nuxeo-note-metadata-layout.html); the new app does not fetch it"; and
  `narrow-schemas=dublincore`, as "Web UI asks for the document with every schema (\*), the new app
  only with dublincore". The second was not also reported as a property the new app did not fetch:
  the proxy's `X-NXproperties: *` still brought it every schema, which is why the rule's second part
  reads what the browser sent.
- **The made-up Acme-Claims package with M2's corpus**, and its conversion: check 3 confirmed
  `dc:title` on the server, and failed on "the server has no vocabulary claim_decision", which the
  package names and does not define. Web UI serves none of its 21 files and the new app none of
  its 6 layout files as they are held, so checks 5, 6 and 7 said they need the package installed
  and the conversion served.

**A layout of the new app that leaves out a property Web UI shows** is reported: `lab.spec.ts`
holds it. On this server it cannot be seen live: Web UI's stock layouts show Dublin Core and a
note's format alone, which the new app's Properties panel draws whatever its layout files say. It
needs a package's Web UI layouts on the server, as the lab server will have them.

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

  For M2, [`m2-corpus.ts`](src/testing/m2-corpus.ts) adds, on a type and a workflow of its own:
  a task layout in Web UI's own format, and one whose names' case the package does not give; three
  layout blocks a view and an edit layout and two tabs use, one of them under a condition, one
  inside another, one given no document, and one used nowhere; and tabs that convert, beside tabs
  on every type, under a path test, with no page, on a type with no view file, and a page with no
  tab.

- **A converted task form drawn by the app.** Web UI's own SerialDocumentReview task layouts,
  converted with the variables schemas the reference server holds for them, gave
  `tasks/SerialDocumentReview.Task6d8.layout.json`. Served with `config:dev`, the app's task
  panel drew it on an open task of that step: the initiator's comment read-only, with its value,
  and the comment editable. The stock files are not in this repository; the evidence is outside
  it.
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

  - **In M2, 69 guards**, broken in turn the same way, and each seen turning the suite red:
    - **In the inventory:** the task layout's kind and its variables; its permissions out of
      scope; a field's two-way binding; a block known by its layout behaviour, in a file of one
      element; a block use's document, condition and place among the fields; a slot
      contribution's `disabled` and template.
    - **In the second count:** task fields, block uses, and a block's fields at each use.
    - **In the conditions:** a permission test of a task layout's document, alone or joined with
      another.
    - **In the converter:** the case of a task form's names, and names differing in case only; a
      variable Web UI only shows made read-only, and version 1 reporting what it cannot make
      read-only; a block given no document; a block under a condition, in version 1 and in version
      2; a field of a block under a condition kept once behind a field everyone sees; a block
      inside a block; a tab named as Web UI's own, with no page, under a condition that does not
      convert, whose page is no block, or on every type; a disabled tab, a later one of its name
      replacing it, a lower priority ignored, a contribution with no template changing another;
      an order left out being 0, the View tab first, the tabs in Web UI's order; a tab on fewer
      types reported, and a view of the preview alone said so; a tab's label, rule and card names;
      tabs left to their converter.
    - **In check 2:** a block's fields; a tab or a task form no Web UI one gives; read-only
      against a two-way binding; version 1 saying what it cannot make read-only.
    - **In check 3:** a task's variables, and their widgets.
    - **In check 5:** a field of a block under a condition kept in its own card and under its
      rule; a tab without its rule; a tab's and a block card's rule held to their conditions; a
      field's rule found in its own card; only a rule that always passes taken for a read-only
      field; a property everyone sees only through a field Web UI shows.
    - **In check 6:** a tab's label.
    - **In check 1:** a block use as a construct.
    - **After the second review:** a permission test of a block a task layout uses, in the
      converter and in check 5; a record field of a task form neither required nor left
      unreported, in the converter and in check 2; a display element, a read-only input, a
      computed binding and a native input, read as Web UI binds them.

    Four rounds ran. The first found five guards no test reached: a block file of two elements, a
    `dom-if` on a task layout's document, a block under a condition in version 1, a field of a
    conditional block kept behind one everyone sees, and a rule moved to another card. The third,
    after the review below, found two: a permission rule joined with another, and the tabs'
    order, which a second sort hid. The fourth, after the second review, found that no test sent
    a required record field through the conversion unreported. Each now has its test, and the
    second sort is gone.

  - **For the slot registration, 42 guards**, broken the same way, each seen turning the suite
    red: in the registry, a disabled contribution, one with no template and one a change moves
    showing nothing, a lower priority ignored, a later one of the name replacing in the earlier
    one's place, a change moving the earlier one or taking it to another slot, the slot sorting
    after each registration, a contribution with no template registering, each slot a contribution
    names, no name never merging, an order left out being 0, a change of Web UI's own reported, and
    slots kept apart; in the inventory, Polymer's numbers and the custom bundle read; for actions,
    only what the slot keeps owning one, what it leaves out reported, the slot's order, Web UI's
    order and its default order written; for the menu, a left-out entry being none, the page the
    slot keeps, the slot's order and Web UI's order; check 5's left-out entry and the page it
    keeps; and check 6's order of an action and of a menu entry, and an action's label. After the
    second review, eleven more: a tab only of a contribution to the tab slot, a priority compared
    as Web UI compares it, moved and disabled read as disabled, Polymer's `NaN`, the slot sorting
    after each registration rather than once, an order that is no whole number reported for an
    action and a menu entry, a button's and a menu icon's translated label, check 6's translated
    label, and check 6's equals in Web UI's places. Three rounds found five no test reached, each
    now tested.

  - **For the report and its decisions, 74 guards**, broken the same way, each seen turning the
    suite red:
    - **Reading `decisions.json`:** its format; its build, by name, version, Studio's commit and
      build time, and the bundle's SHA-256, held to the package given in readiness and in the
      report; a key of the file it does not take; its list; a decision of no item or of an empty id; one listed twice; a key a
      decision does not take; an item the report does not list, or does not report, and the word
      that accepting a proposal is not built; each of the six things a decision copies, compared
      as JSON whatever the order of its keys; an owner or a decision that is not text, or only
      spaces; each reported item once, by the first entry of its id; a file it takes nothing of,
      named.
    - **Carrying an earlier file:** only what still holds, never another build's, an entry that
      says nothing passed over, and the entries left to fill in counted.
    - **Readiness:** each of its three kinds of line; a conversion made with another allow-list
      than the deployment's; an id listed twice read by its first entry.
    - **Check 1:** the report of the package given, by name, version, Studio's commit and build
      time.
    - **The report:** the package handed in, and the allow-list the harness used; a construct
      missing, and an outcome that is none; decided only with an owner and a decision; the
      coverage of what the report lists; an item, and a proposal, listed once, by its first entry;
      what a file became, only of what was converted; an owner and a decision each shown, or none;
      what people and the package wrote, on one line each.
    - **Elsewhere:** `decisions.json` written and read with the conversion, never written over;
      the command's errors; `mutate --list` and `mutate` naming the decisions; three controls
      breaking what they say; a control needing a decision filled in, and working from one
      readiness takes.

    Before the first round, four guards were seen to have no test reaching them: the copied rule
    compared as JSON rather than as an object, a decision of spaces, a proposal listed twice, and
    what a file became taken from what was reported. Each got its test, and the round found none.
    After it, reading the code found that a control could break a decision readiness already left
    aside. It now works from one readiness takes, and its test fails on the old choice. The second
    round, of the 17 guards the first review's fixes brought, found none. The third, of the 8 the
    second review's brought, found two no test reached: readiness and the report taking the build
    a decisions file names for the package given. Each now has its test.

  - **An independent review of the report**, by reviewers given only the diff and the
    `pre-pr-review` skill, ran two rounds.
    - **The first** found nine things, all fixed with tests: decisions taken for a report of
      another version, as the header and the version check read `report.json` rather than the
      package given; `--from` carrying one construct's decision to another across versions, since
      ids are places in files; the header's allow-list not the one the harness used; a decision
      hidden in the text where its owner was blank; `--from` calling an entry that said nothing
      "decided", and keeping no word of what it dropped; two readings of an id listed twice; a test
      whose name claimed a case it did not run; and prose that said more than the code.
    - **The second** confirmed those and found what they left. Fixed, each with a test: two builds
      of one name and version whose manifests record no commit or build time were one build, so
      `--from` carried decisions between them, which the bundle's SHA-256 now stops; the report
      counted another build's decisions as decided; a reported button's reason could name an
      allow-list other than the deployment's; readiness counted an id listed twice by every entry;
      an owner's words could print a line of their own in the report; and stale prose. Left as
      they are: check 1 tells two such builds apart only by their constructs, as its entry above
      says.

  - **An independent review of the slot registration** found eleven things. Fixed, each with a
    test: a contribution with no template that comes first was not registered, so its priority did
    not outrank a later one; the custom bundle's contributions were not read; a contribution naming
    several slots took no part in their registration; a replacement took the place of the kept one
    rather than the earlier one's; a fractional priority or order was not read; Web UI's default
    order was written for a change and not for the rest; check 5's two new lines had no test; and
    an action's label was not checked. The rest are limits, under **Not done yet**: Web UI's own
    contributions, the order Web UI loads files in, a menu entry's page paired by the
    contribution's name, and what the checks share with the converter. A second round confirmed
    them and found six more, fixed the same way: a tab item contributed to two slots was written as
    a tab and reported; no test held the sort after each registration; a fractional order was left
    out of the file without a word; Web UI translates a button's and a menu icon's label, which
    the converter and check 6 read as text; a `NaN` or `Infinity` priority was read as 0; and
    check 6 did not look at equals' places.

  - **An independent review of M2** found twelve things. Fixed, each with a test: a guarded
    block's field moved under another block's rule passed check 5; a block given no document hid
    a dropped rule; a disabled tab, or one a later contribution replaced, still became a tab; Web
    UI's task page fetches the task's target whole, so a task layout's record fields, blocks and
    type, facet and state tests convert, where the first version reported them all on a reading of
    the server's plain answer; a field bound two ways inside a wrapper became read-only; a field
    Web UI only shows became an editable field of a version 1 form, unreported; a tab with no order
    sorted last, and the record page opened on another tab than Web UI's; a tab on fewer types
    than Web UI was `converted`; a view of the preview alone gave a false reason; and stale counts
    in the migration document. Two are limits, listed under **Not done yet**: check 3 with one
    variables schema in the package, and what the checks share with the converter. A second round
    confirmed the fixes and found three regressions they brought, fixed the same way: a permission
    test inside a block a task layout uses became a rule; a required field of the record made the
    task form one the app refuses; and a display element or a read-only input bound two ways, or a
    computed binding, read as editing its value.

  - **An independent review of M1** found twelve ways to drop, widen or misread something that
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
- **For the guided migration, 28 guards**, broken one at a time by a script that runs its specs
  and restores the file, each seen turning them red:
  - **Before anything is written:** an `--out` that holds files, is a file, or is empty; a package,
    an `--allow-list` and a `--from` that cannot be read, and an allow-list of the wrong shape.
  - **The steps:** `--out` given in full; the package read once; a step that exits non-zero
    stopping the run, and a failed check not; one that throws stopping it; each file written only
    where none is; the allow-list given to `convert`, `check` and `report`; `--from` given to
    `decisions`, found in a run and in a conversion, and its step run before the checks.
  - **What it says:** a run that wrote nothing saying so, and what a stopped run wrote read from
    the disk; a server half listed only when it did not run, and the other checks that did not run
    whole; nothing left to fill in said so, and a decision of spaces still to fill in; exit 1 on a
    failed check; the next free directory.
  - **In `cli.ts`:** `check` handing its result to `migrate`.

  The first round, of 24, found none no test reached. The second, after the review's fixes, found
  one: a decision whose owner is spaces alone counted as filled in, which no test sent through
  `decisions`. It now has its test. A guard of the first round whose text the fixes had changed was
  skipped by the script without a word; it was run on its own, and turned the suite red.

  Each of the three controls the guide's reader meets was also run with `npm run studio-migration`
  on a package written to disk: an `addon` package and a file that is no zip, refused at the
  inventory with nothing written; a theme folder the conversion refuses, stopping at step 2 with
  only `inventory.txt` written; and a second run into a filled-in run's `--out`, refused with its
  19 files unchanged.

- **For lab mode, 50 guards**, broken one at a time by a script that runs its four specs and
  restores the file, each seen turning them red:
  - **The rule:** a field under a condition not held, and only what Web UI fetched; a property
    the new app does not fetch, or cannot show; the page's fields, a layout file it loaded, and
    the rows the page draws itself, each as what it can show; the schemas, every one and by name;
    a new app that never asks, or is answered otherwise; Web UI never asking; identity, and what
    could not be read; a read by path; Web UI's conditions; the servlet's envelope; a Web UI
    layout that did not load.
  - **The browser:** downloads through the API and through the servlets; only reads, and only the
    operations that only read, by `POST`; the header to the server's origin alone; controls on
    the new app alone; an unsigned request, an answer naming another, and none naming the user; a
    refused request recorded; a layout, and a page, that could not be read, kept as such.
  - **The server's reads:** one origin, no redirect; a field, a widget's type and a type's
    schemas, a vocabulary, a page provider and a task's variable, each against the server's
    model; a model that cannot be read; the package byte for byte, and the conversion as JSON.
  - **The command:** the credentials, a new or empty `--out`, who the credentials are, exit 2 on
    identity and 1 on a difference or a document not compared, the package installed and the
    conversion served, and check 3 failing.

  Four rounds ran. The first, of 46, found three no test reached: a field on the new app's page
  that no layout file lists, as its generated layout shows one; a layout Web UI was refused whose
  answer has a body; and the control kept to the new app, which a second test of the same thing
  hid, now gone. The script did not find a fourth, whose text formatting had changed. The second
  round found that one reached by no test either, the package served without its conversion. Each
  now has its test, and the third round found none. `pre-pr-review.mjs` then found two empty
  `.catch()`es: a layout whose answer could not be read was dropped, which would have made what
  Web UI shows look smaller, and so held less. Each is now kept as unreadable, which stops the
  document's comparison and exits 1, and the fourth round, with their four guards, found none. A
  spec drives `recordApp` through a small stand-in for Playwright, so the browser half is held too:
  what is refused, sent and recorded.

## Not done yet

- **The rest of migration M4:** the upload, which validates a package sent to a service and returns
  its report; many packages in one run; the support playbook. `migrate` runs on a copy of this
  repository, so a customer needs `npm ci`, and with it a read token for the Hyland packages on
  GitHub Packages.
- **The rest of the server halves.** Lab mode runs check 3's whole, and checks 6 and 7 on the
  pages of the documents it is given. Still to come, on the migration lab server, with the Studio
  package installed and Web UI beside the new app (development plan, phase 4), which neither local
  server has:
  - check 5, the conditions evaluated in Web UI, with test users that lab mode, writing nothing,
    does not create;
  - check 6's values, compared as each app shows them, and its labels as each page shows them;
  - check 7's lists and buttons, with their result counts: a button runs an operation, which lab
    mode refuses unless it only reads;
  - another user than one, and the app registry's files: lab mode signs one user in, and finds the
    conversion only where `config:dev` serves it.
- **What lab mode shares with the app.** What the new app's pages draw themselves outside a layout
  file is a table in `lab.ts`, a copy that a test holds to those components' sources, rather than
  something read from the page.
- **Check 9** needs plugins, in M3.
- **Conditions that do not travel yet:** on a version 1 field, on a list's column and on a search
  screen's table. The server half of check 5 needs the migration server.
- **Version 2 forms.** The app now draws `edit` and `create` files of version 2 (layout-v2.md,
  section 11), and the converter still writes version 1 there, so a field, or a layout block,
  under a condition in a form stays pending. Writing those modes in version 2 is the next step.
- **A tab's listing.** A tab whose page is a page provider and a table, rather than a layout block,
  is reported: section 3's "a list over the page provider" would be a card of related records
  (layout-v2.md, section 7), and is not written yet.
- **Web UI's own contributions.** The slot registration sees the package's contributions only.
  One that shares its name with a contribution of Web UI's own replaces it in Web UI, and the app
  keeps its own; a list of Web UI's contributions, by slot and name, would let the converter report
  it. A contribution to several slots at once, `slot="A,B"`, takes part in each slot's
  registration, but is itself a slot the catalogue does not know, and is reported.
- **The order Web UI loads files in.** The registration reads the custom bundle, then each
  slot-contributions file, as the bundle lists them. Web UI loads the bundle the package's own
  web resources register (`OSGI-INF/extensions.xml`), and the files its `<link rel="import">`
  names, in that order; both could be read from the package, and are not yet. So a
  `nuxeo-*-bundle.html` that is neither registered nor imported is read as if Web UI loaded it, as
  the made-up corpus's slots and tabs bundles are, and where Web UI loads two files in the other
  order, two of one name at one priority resolve the other way.
- **A menu entry's page** is paired with the entry by the contribution's `name`, as M1 does. Web UI
  pairs the menu icon with the page by the stamped elements' own `name` (`nuxeo-app.js`,
  `attr-for-selected`); Studio writes the two the same, but a package that does not would open a
  page Web UI does not. Follow-up.
- **What the checks share with the converter.** The checks hold what each file shows to the
  package, but they take from the converter's own planning (`forms.ts`, `blocks.ts`,
  `convert-tabs.ts`, `convert-tasks.ts`, `convert-layouts.ts`, `slot-registry.ts`,
  `convert-slots.ts`, `convert-home.ts`): which actions, menu entries and tabs exist, and at what
  order, as `slotRegistry` reads Web UI's slots, so a mistake in that reading passes checks 5, 6
  and 7 alike, and its controls only move the output away from it; which tab is which, which types each goes to and the conditions of its
  rule; which file a task form is; which card is a block's; and, through `planFields`, which field
  a rule belongs to. Whether a field edits is the inventory's reading of its bindings, for both. A
  mistake there would pass both. Only check 1's second count reads the package another way, and
  it too takes the files' kinds, layout blocks among them, from the inventory.
- **A task variable only one variables schema holds.** Check 3 fails a variable neither its step's
  nor its workflow's schema has only when the package holds both schemas. With one of them on the
  server, the variable may be that one's, and the check lists it as resting on the platform.
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
- **Accepting proposals.** A reported item takes an owner and a decision in `decisions.json`; a
  proposal takes nothing yet. Accepting one means the converter writes what was accepted, a
  condition's rule or the page provider of a card fed by an operation, so the decisions file would
  feed `convert`, and check 5 would hold an accepted rule as it holds a converted one. Until then
  every proposal waits, and the verdict says how many.
- **A reviewer's approval of the report.** `report` prints what the reviewer approves, and no
  command records that they did.
- **Contrast against the base palette:** a pair is checked only when the theme sets both tokens.
  A pair the theme sets only half of is not checked yet. Checking it needs the compiled palette's
  values, which are Sass and not JSON.
- **Waiting on real packages.** Only the sample is in hand, and it has no condition, no custom code,
  no task layout, no tab, no layout block, no second language and no button that runs an
  operation. M2's task forms, tabs and blocks are read from Web UI's own sources and tested on the
  made-up corpus alone. Real packages will show:
  - **the folder Studio writes layout blocks to**, and whether every block is an element with
    `Nuxeo.LayoutBehavior`, as the documentation's tutorial writes one: a block is known by what
    it is until then, and one of another make is a file of no known kind, reported;
  - **what Studio writes for a workflow:** whether it contributes the variables schemas
    `var_<workflow>` and `var_<step>`, as the reference server holds them, and how it imports the
    workflow, whose model file is of no known kind until then. A task layout whose names' case the
    package does not give is reported;
  - **the script Studio generates for a task layout**, whose shape the catalogue does not know, so
    each such script is customer code, pending M3, until it does;
  - **what Studio Designer writes for a tab:** its item and page, and whether the page is a layout
    block or an element of its own;
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
