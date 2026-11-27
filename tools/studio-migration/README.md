# Studio migration

Phases M0 to M3 of the migration in
[docs/business-apps/studio-migration.md](../../docs/business-apps/studio-migration.md). It reads a
Studio Designer package written for Web UI and accounts for everything in it. It converts the
declarative track (M1, and M2's conditions, task forms, tabs and layout blocks) into an app
definition the package pipeline's validator accepts, proposes each custom element as a Layer 2
plugin and scaffolds it (M3, the code track, below), and runs the verification harness over the
result. It prints the report a person approves, with every reported item's owner and decision and
every proposal accepted or rejected, writes what a person accepted, carries decisions to a new
build of the package, and records the reviewer's approval.

**A customer migrating their own package** runs one command, `migrate`, and follows
[the guide](../../docs/business-apps/studio-migration-guide.md), which is written for them:

```bash
npm run studio-migration -- migrate <package.zip> --out <new-directory> [--allow-list <file>] [--from <earlier run>]
npm run studio-migration -- migrate <package.zip or folder>... --out <new-directory> [--allow-list <file>] [--from <earlier run of them>]
```

A support engineer helping them follows [the support playbook](../../docs/business-apps/studio-migration-support.md),
which says what every finding the tool can print means and who acts on it.

The commands it runs, one by one:

```bash
npx tsx tools/studio-migration/src/cli.ts inventory <package.zip> [--json]
npx tsx tools/studio-migration/src/cli.ts convert <package.zip> <new-directory> [--allow-list <file>] [--decisions <decisions.json>]
npx tsx tools/studio-migration/src/cli.ts check <package.zip> <conversion-directory> [--json] [--allow-list <file>] [--plugins <repository>] [--run-plugins] [--observed <file>]
npx tsx tools/studio-migration/src/cli.ts mutate <conversion-directory> <mutation> <new-directory>
npx tsx tools/studio-migration/src/cli.ts mutate --list
npx tsx tools/studio-migration/src/cli.ts decisions <package.zip> <conversion-directory> [--from <decisions.json>]
npx tsx tools/studio-migration/src/cli.ts report <package.zip> <conversion-directory> [--json] [--allow-list <file>] [--plugins <repository>]
npx tsx tools/studio-migration/src/cli.ts approve <package.zip> <conversion-directory> --by <name> [--plugins <repository>]
npx tsx tools/studio-migration/src/cli.ts migrate <package.zip> --out <new-directory> [--allow-list <file>] [--from <earlier run>]
npx tsx tools/studio-migration/src/cli.ts migrate <package.zip or folder>... --out <new-directory> [--allow-list <file>] [--from <earlier run of them>]
npx tsx tools/studio-migration/src/cli.ts plugin <package.zip> <custom-element> [--workspace <directory>] [--owner <prefix>] [--restamp]
npx tsx tools/studio-migration/src/cli.ts lab <document>... --out <new-directory> [--app <url>] [--web-ui <url>] [--nuxeo <url>] [--package <package.zip> --conversion <conversion-directory>] [--control <control>]
```

`npm run studio-migration -- <command> …` runs the same, from the repository's root.

- `inventory` says what the package holds, what each part becomes and what someone has to decide.
- `convert` writes the M1 conversion and its report. `--decisions` writes what people accepted in
  a `decisions.json`, of this build or an earlier one, carried as `decisions --from` carries it.
- `check` runs the harness on a conversion. Check 9 reads the plugins of the package's custom
  elements from this repository, or the one `--plugins` names; `--run-plugins` runs them too, and
  `--observed` gives what each element shows, for the values half (below, **The code track**).
- `mutate` writes a deliberately broken copy of a conversion, for the harness to refuse.
- `decisions` writes the conversion's `decisions.json`, for people to say who owns each reported
  item and what they decided, and who accepts or rejects each proposal, and why. `--from` carries
  the decisions of an earlier file that still hold, of this build or another build of the package.
- `report` prints the report of the migration document's section 8 (below, **The report**).
- `approve` records a person's approval of the report and its decisions, in `approval.json`, typed
  at a terminal; no other command writes one (below, **The report**).
- `migrate` runs `inventory`, `convert`, `check`, `report` and `decisions` on one package, in that
  order, keeps what each prints in a file of `--out`, and says what to do next (below, **The
  guided migration**). Given several packages, or a folder, it runs each so into a folder of its
  own, and writes a summary of them all (below, **Many packages in one run**).
- `plugin` writes the Layer 2 plugin library of one custom element of the package, from the
  template every customer library comes from, for an agent to finish (below, **The code track**).
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
  not failed. `report` exits 0 once it has printed the report, whatever the report says. For
  `migrate` of several packages: every package ran every step, and no check failed in any.
- **1:** a check failed, or something could not be read or written; the reason is printed. For
  `migrate` of several packages: in any of them.
- **2:** the command was wrong; for `lab`, also its environment (below, **Lab mode**).

`convert` and `mutate` write only into a new or empty directory, `decisions` only a
`decisions.json` the conversion does not hold yet, `approve` only an `approval.json` it does not
hold yet, and `migrate` and `lab` only into a new or empty `--out`, so none of them writes over
anything. `approve` exits 0 once it wrote the approval, and 1 when it refused, writing nothing.

## The guided migration

`migrate <package.zip> --out <new-directory>` ([`src/migrate.ts`](src/migrate.ts)) is phase 10's
first piece of self-service migration (migration M4, in the
[migration document](../../docs/business-apps/studio-migration.md), section 10): a customer runs
it on their own package, and [the guide](../../docs/business-apps/studio-migration-guide.md) walks
them through what it writes.

- **The steps are the commands.** Each is `main` itself, given the arguments a person would type,
  and what it prints goes into a file of `--out`:

  | Step                              | Command                                                                      | In `--out`                                   |
  | --------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
  | 1. The inventory                  | `inventory <package>`                                                        | `inventory.txt`                              |
  | 2. The conversion                 | `convert <package> <out>/conversion`, and `--decisions <from>` with `--from` | `conversion/`, `conversion.txt`              |
  | 3. The checks that need no server | `check <package> <out>/conversion`                                           | `check.txt`                                  |
  | 4. The report                     | `report <package> <out>/conversion`                                          | `report.txt`                                 |
  | 5. The decisions to fill in       | `decisions <package> <out>/conversion`                                       | `conversion/decisions.json`, `decisions.txt` |

  `--allow-list` goes to `convert`, `check` and `report`, and `<out>` is given in full, so that
  every path the run prints opens from any folder. So each file is what the command prints by
  hand into the same paths, byte for byte, and the tests hold them to it.

- **With `--from`,** an earlier run, a conversion directory or a `decisions.json`, of this build
  of the package or another, the conversion step writes what people accepted
  (`convert --decisions`), and the decisions step carries the decisions that still hold
  (`decisions --from`), and runs third, so that the checks and the report count them: inventory,
  conversion, decisions, checks, report. Both carry the earlier file the same way, so the
  conversion is made with exactly the decisions the step then writes beside it. A first run keeps
  the decisions last: a scaffold of blank entries changes nothing the checks or the report print.
  A `--from` of another package, or of a first-format file of another build, is refused before
  anything is written.
- **It never approves.** No step writes `approval.json`: a reviewer runs `approve` at a terminal
  once every decision is made, and the next steps say so.
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
  settle, and check 9 while a custom element's plugin is not written or not run, with what to do.
  Check 10 is never among them: `check` is given the allow-list `convert` was, and without one the
  conversion makes no action.

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
  the conversion refuses, so the checks, the report and the decisions do not run.
- **A `--from` it cannot carry:** the decisions of another package, or a first-format file of
  another build, refused before anything is written. Another build of the same package is carried,
  by each construct's identity, and what it accepted is written.
- **A re-run that would overwrite:** `migrate` into the `--out` of an earlier run, its decisions
  filled in, which refuses before writing anything and leaves the run byte for byte as it was;
  and a file appearing where a step's output goes during the run, which is not written over.

## Many packages in one run

`migrate <package.zip or folder>... --out <new-directory>` ([`src/batch.ts`](src/batch.ts)) is the
second piece of migration M4: a customer with several Studio projects runs them all at once, and
[the guide](../../docs/business-apps/studio-migration-guide.md), section 9, walks them through it.
One argument that is a package file runs as above, unchanged; several, or a folder, run so.

- **From the command line.** `commandLine` in `cli.ts` runs it, and is `main` for every other
  command. `main` itself is unchanged: given several packages it prints its usage, as it always
  did, and its steps are the steps a run of one package takes.
- **Each package runs as one does.** Each is given to `migrateOne`, the run `migrate` makes of one
  package, with the same allow-list, into `<out>/packages/<name>`. `<name>` is its file's name less
  `.zip`, each character but a letter, a digit, `.`, `_` and `-` written `-`, dots at its end
  dropped, and a name Windows keeps for a device, such as `CON`, written `_CON`, so that every
  system can hold it. What that run prints goes into `<out>/printed/<name>.txt`, beside its folder
  rather than in it, so that the folder is byte for byte what `migrate` of that package alone
  writes there, and the tests hold it to that.
- **Isolated.** A run is given only its own package, its own folder and the allow-list. A package
  that cannot be read, is refused at a step, fails a check, or meets a defect of the tool, in a
  step or outside every step, which is caught, ends its own run alone; the next runs as it would
  have without it, byte for byte.
- **The event loop turns after each package.** jsdom keeps every document until the job that made
  it ends: a run of the made-up package with M2's corpus holds about 170 MB of them, and a run of
  many packages in one job would add them up until the heap ran out, as the tests did at 4 GB
  before it turned. Its test holds that the loop turns after each package, not what that frees: the
  heap, measured by hand with `--expose-gc` before each of 48 made-up packages, stayed between 66
  and 77 MB.
- **Read once for its run.** Each package's bytes are read once, hashed, and given to its run,
  as one run gives each step the same bytes, and let go after it; so is the allow-list, read once
  for every run. A path given twice is read again, and found by its bytes to be the same package.
- **The summary,** `summary.txt`, is what the command prints: for each package, its result, what
  its `package.xml` declares, its constructs by outcome as its report counts them (`CliIo.reported`
  hands `migrate` the report's own summary, as `checked` hands it the harness's), its report and
  what it printed; then how many ended each way, the worst, and what to do next. `summary.json`
  says the same as data, with paths under `<out>`, `/`-separated, and its `format` is
  `studio-migration-batch/1`.
- **Results,** best first: `ready`; `not ready`, every step ran and no check failed;
  `check failed`; and `stopped`, at a step, before the first, or by a defect. The worst is the
  run's.
- **Duplicates.** The same bytes given twice, under any name, run once; the second is
  `the same package` as the first, and not run again. Two files of one name from two folders get
  two folders, `claims` and `claims-2`, told apart as a file system that ignores case would. Two
  packages that declare one name and version from different bytes, most often two builds of it,
  both run, and the summary says so. A folder given twice is listed once.
- **A folder** gives the `.zip` files directly in it, by name; what else it holds is listed as left
  out, but for names that start with a dot, the system's own, such as the `._<name>.zip` a Mac
  leaves beside a file on a drive that cannot hold its attributes, which are passed over. A folder
  with no `.zip` file is refused before anything is written.
- **`--from` an earlier run of several** carries each package's decisions from the earlier run's
  folder, found through its `summary.json`: the folder of the same bytes, whatever the package's
  file is called now, or else the one folder of the same build, as `decisions.json` names it,
  which is what `--from` holds one package's decisions to; or else the one folder of another build
  of the same package, by the name its `package.xml` declares, whose decisions are carried by each
  construct's identity. When that run held the build under two sets of bytes and none is the
  package's, or several other builds of the package and not this one, none is taken, and its line
  says so; one whose run stopped before its decisions step says "Not carried". A package that run
  did not hold, or holds no decisions for, starts again, and its line says so. A folder name read from that summary is used only when it is one the
  run could have made. `--from` a run of one package, or a summary that lists no packages, is
  refused.
- **It never writes over anything:** `--out` must be new or empty, and each file is written only
  where none is.
- **Exit codes,** the worst of its packages': 0 every package ran every step and no check failed
  in any; 1 one stopped or failed a check, or the run of them all was refused before writing, or
  its summary could not be written; 2 the command was wrong.

**Its negative controls**, each in [`src/batch.spec.ts`](src/batch.spec.ts): a package that is no
zip and an `addon` package among two sound ones, which stop alone while the others' folders and
what they printed are unchanged; a package whose check fails, one whose report step throws, and one
whose run throws outside every step, before sound ones, likewise; a path that is no file; an
`--out` that holds files, a folder of no `.zip`, an allow-list of the wrong shape, and a `--from`
that is a run of one package, nothing, or a summary of no packages, each refused with nothing
written; the same package three times, under two names; three files of one name, two of them
differing by case alone, and the names Windows cannot hold; a folder it cannot read; a renamed
package, carried by its bytes; a package zipped again, carried by its build; one build held twice
by the earlier run, each carrying its own, and a third set of its bytes carrying neither; a run
stopped before its decisions step, which carries nothing; and the event loop turning after each
package.

**The single-package command is unchanged,** byte for byte:
[`src/migrate-single.spec.ts`](src/migrate-single.spec.ts) holds what it prints and writes, on
both made-up packages, with and without an allow-list, with `--from`, refused at each point, and
with a check that fails, to SHA-256s written on `staging/enterprise-grade-app` at 7912b146e, before
the batch was built. A change meant to change them writes them again with
`UPDATE_MIGRATE_GOLDEN=1`, and says why. The one line of output it changes is the usage text, which
gains the batch's form.

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
  - check 8 failed, and three checks ran in part;
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

| Outcome     | Meaning                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `converted` | Done, with where it went                                                                                                          |
| `proposed`  | An agent proposes it, and a person accepts it                                                                                     |
| `reported`  | It does not migrate, with why                                                                                                     |
| `generated` | Studio's own packaging, records and templates                                                                                     |
| `server`    | It stays on the server in the Studio package, and the new app reads it                                                            |
| `pending`   | A later phase converts it, and the note says which: a version 1 field under a condition once the converter writes version 2 forms |

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
- **Check 9, plugins,** holds each custom element's plugin to the element (below, **The code
  track**). Its scan of the plugins and of the configuration needs only the files; its tests,
  gates and values run with `check --run-plugins --observed <file>`. Until a plugin is written,
  or run, the check is `partial`. A package with no custom element passes it, its configuration
  holding no code.

**Readiness.** A migration is ready only when all ten pass, nothing is pending, every proposal is
accepted or rejected by someone named, for a reason, and the conversion was made with those
decisions, every reported item has an owner and a decision in `decisions.json`, with nothing wrong
in that file, and a person has approved the report and its decisions as they are, in
`approval.json` (below, **The report**). Given `--allow-list`, the conversion must also have been
made with that list, since a reported button's reason names the list it was made with. So an M1
run is never ready, and it lists what stands in the way. An id the report lists twice is read by
its first entry.

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

**Check 9's controls.** Twenty-five more, in the same file as `PLUGIN_MUTATIONS`, break the
plugins or the conversion of the made-up corpus's two custom elements; `src/check-plugins.spec.ts`
applies each and sees check 9 fail, with a finding it names for each. Ten of them check 9 sees only
by running the plugin, and the spec runs each from a copy of the plugin's files with the control
applied, as `check --run-plugins` does. `mutate` does not apply them: it breaks a conversion's
directory, never a plugin.

| Mutation                      | Run | Breaks                                                                   |
| ----------------------------- | --- | ------------------------------------------------------------------------ |
| `plugin-writes-html`          |     | Writes a value the plugin shows as HTML, with `[innerHTML]`              |
| `plugin-drops-value`          | yes | Takes a value the element shows out of the plugin's template             |
| `plugin-test-fails`           | yes | Makes one of the plugin's own tests expect another value                 |
| `plugin-todo-left`            | yes | Leaves one of the plugin's tests `it.todo`                               |
| `plugin-bypasses-http`        |     | Sends the plugin's request through an `HttpClient` of its own            |
| `plugin-asks-other-operation` | yes | Makes the plugin run another operation than its element                  |
| `plugin-registers-more`       | yes | Registers a rule of the plugin's own beside its component                |
| `plugin-changes-event-detail` | yes | Emits an event with another detail than the element fires                |
| `plugin-asks-on-render`       | yes | Sends a request as the plugin is drawn, where the element sends none     |
| `plugin-extra-button`         | yes | Gives the plugin a button the element does not have                      |
| `plugin-skips-tests`          | yes | Takes the plugin's tests of its behaviour away, with `describe.skip`     |
| `plugin-empty-test`           | yes | Gives the plugin a test that asserts nothing                             |
| `plugin-bypasses-sanitizer`   |     | Trusts a value past Angular's sanitiser                                  |
| `plugin-drops-output`         |     | Takes an output for one of the element's events off the plugin           |
| `plugin-not-built-in`         |     | Leaves the plugin's provider out of the template app                     |
| `code-in-plugin-metadata`     |     | Puts the element's code into `studio-plugin.json`                        |
| `plugin-project-target`       |     | Makes the plugin's `typecheck` target run something else                 |
| `plugin-runs-eval`            |     | Runs text as code, with `eval`                                           |
| `plugin-binds-nuxeo-src`      |     | Binds a document's file to an image's `[src]`                            |
| `plugin-third-party-api`      |     | Puts a type of another package in the plugin's public API                |
| `plugin-own-test-config`      |     | Changes how the plugin's tests run, in its own Vite configuration        |
| `plugin-from-changed-element` |     | Holds the plugin to another definition of its element                    |
| `code-in-configuration`       |     | Puts the element's code into the conversion's record page, as a template |
| `drop-element-entry`          |     | Leaves a custom element out of the report                                |
| `plugin-needs-no-decision`    |     | Gives an element's plugin as proposed with no decision of its own        |

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

**The controls of proposals, carrying and the approval.** Seven more, for what this slice holds
([`src/proposals.spec.ts`](src/proposals.spec.ts), [`src/carry.spec.ts`](src/carry.spec.ts),
[`src/approval.spec.ts`](src/approval.spec.ts)). The proposals' controls write the app as a
converter that disobeyed `decisions.json` would, read the package, and fail check 5; the others
break a carried decisions file or an approved conversion, and readiness must name them:

| Mutation                   | Caught by | Breaks                                                                                          |
| -------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `write-undecided-proposal` | check 5   | Writes a proposal no one has accepted or rejected, as if it were accepted                       |
| `write-rejected-proposal`  | check 5   | Writes a proposal a person rejected, as if it were accepted                                     |
| `drop-accepted-proposal`   | check 5   | Leaves out what a person accepted, as a conversion made without the decision would              |
| `carry-to-other-construct` | decisions | Carries a decision to another construct, with that one's reason, as a carry by place would      |
| `carry-changed-silently`   | decisions | Carries a changed construct's decision as it was made, rather than offer it for re-confirmation |
| `approve-other-report`     | approval  | Makes the approval one of another report than the conversion holds                              |
| `change-after-approval`    | approval  | Changes a reported item's decision after the report was approved                                |

Each is applied by the tests to the made-up package: the proposals' to it with M2's corpus and the
proposals the tests add, a button under a filter's known expression and a card the favourites
operation feeds, one proposal accepted, one rejected and one undecided; carrying's to a new build
of it, a field added above another, a search field relabelled, a theme property removed and the
view's `dom-if` testing another facet; the approval's to a decided run approved through a stand-in
for a terminal, and written to disk with `mutate`. Each was seen failing: a check, or readiness
naming it. The sample is not in this repository, and was not used.

**The controls of the plugins' joins.** Three more, `PLUGIN_JOIN_MUTATIONS`, for where check 9
meets the decisions and the approval ([`src/plugin-joins.spec.ts`](src/plugin-joins.spec.ts)). Each
breaks the made-up corpus's migration with both plugins accepted, by name and for a reason, and its
report approved, and readiness must name what broke while check 9 still passes:

| Mutation                          | Caught by | Breaks                                                                                       |
| --------------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| `accept-plugin-undecided`         | decisions | Records a plugin as accepted in the report, with no decision of it in `decisions.json`       |
| `carry-plugin-to-changed-element` | decisions | Carries a plugin's acceptance to its element changed in a new build, rather than drop it     |
| `change-plugin-after-approval`    | approval  | Changes a file of an accepted plugin after the report was approved, check 9 passing it still |

The new build for the second gives the exposure element one more comment, so its identity is
another and carrying drops its acceptance; the control puts it back. Each was seen failing, and
each guard it holds was broken on purpose and seen to turn the spec red: the plugin's entry with
no decision, the approval blind to the plugins, the element's identity blind to its definition,
and a rejected plugin left built in. `mutate` does not apply them.

## The report

Section 8 of the migration document describes the report a person approves, and step 5 of phase 4's
demo shows it: 100% of the package accounted for, and every reported item with an owner.

**The decisions** ([`src/decisions.ts`](src/decisions.ts)). `report.json` is the converter's, the
same for the same package and the same decisions every time. What people decide is kept beside it,
in `decisions.json`, which no conversion writes, so that converting the same package again, once
the catalogue has learnt something, loses none of it.

- **For one build of the package.** A file of decisions names the package's name and version,
  Studio's commit and build time from the bundle's manifest, and the SHA-256 of the bundle, and
  `check` and `report` take it only for the package they are given, when all five are the same.
  The bundle's SHA-256 tells two builds apart where the manifest records neither commit nor build
  time, as when a project keeps its version.
- **`decisions <package> <conversion>`** writes `decisions.json`, in the provisional format
  `studio-migration-decisions/2`: the build, and an entry for every reported item and every
  proposal that takes a decision, in the report's order. Each entry copies what it is made on from
  the report, the item's label, property, outcome, where it was written (but for a proposal, where
  accepting it writes), its reason and its rule, and its construct's `identity` (below). A
  reported item's entry leaves `owner` and `decision` for a person to fill in; a proposal's,
  `owner`, the person deciding, `decision`, `accept` or `reject`, and `reason`. It never writes
  over a `decisions.json` the conversion holds.
- **A proposal** is a condition's rule in a known JavaScript pattern, marked `proposal` in the
  report, or a dashboard card an operation feeds. What a condition's proposal guards, a field, an
  action, a tab or a card under it, is `proposed` too, and takes no decision of its own: it follows
  its condition's. A proposal is decided once someone named accepts or rejects it, for a reason; a
  card an operation feeds proposes nothing the converter can write yet, and is rejected or waits.
- **`convert --decisions <decisions.json>`** writes what people accepted
  ([`src/convert.ts`](src/convert.ts), `convertWithDecisions`): it converts, carries the file to
  that report as `decisions --from` does, and converts again with the proposals' decisions, given
  to the inventory's conditions (`withVerdicts`). An accepted rule is written as the `visibleWhen`
  of what its condition guards, as a converted condition's is; a rejected one's condition is
  reported, and so is what it guards, for a decision of its own. The report keeps each proposal
  `proposed`, as it was proposed, and records `applied`, what the conversion was made with, and
  `to`, where an accepted one went.
- **Held three ways.** `runHarness` gives the checks the inventory with the proposals' decisions
  the report records the conversion was made with (`recordedVerdicts`), so check 5 holds an
  accepted rule on every row of its truth table, a rule written for a proposal not accepted, or one
  rejected, as a rule no condition gives, and an accepted rule's field left out as missing
  (`check-conditions.ts`); an action left out is check 7's. Readiness holds what the report records
  to `decisions.json` (`madeOtherwise`), so a conversion made before a decision, or with another,
  is said to be, and passes its checks; and holds `report.json` to the converter, converting the
  package again with the allow-list and the decisions the report records (`reportDiffers`), so a
  proposal relabelled `converted` by hand, or any construct the report gives otherwise than the
  converter does, is said to be. So nothing proposed is written unless a person accepted it, and
  nothing accepted is left out.
- **What waits.** Readiness counts a proposal of its own that no one has accepted or rejected as
  waiting; what a proposed condition guards follows it and is not counted. A name, a decision or
  a reason holds a letter or a digit: spaces, or characters that show nothing, such as a zero-width
  space, are none.
- **A construct's identity** ([`src/constructs.ts`](src/constructs.ts), `identityOf`) is a
  fingerprint of its kind, its file and what it is there, such as a field's element and the
  property it binds, a condition's test, a contribution's slot and name, or a card's heading, page
  provider, operation and parameters and whether it repeats another. Never its place among its
  file's constructs: Studio names files after what they hold. It is the same in every build where
  the construct is unchanged, wherever it moved, and shared by constructs a build cannot tell apart
  (`sharedIdentities`).
- **`--from <earlier decisions.json>`** carries each decision of an earlier file that still holds:
  - **of the same build,** by its item, where the decision still holds for this report, as before,
    and one made on something the report gives otherwise now is offered for re-confirmation;
  - **of another build of the package,** by its construct's identity: to the construct of this
    build of the same identity, when what it was made on is unchanged; offered for re-confirmation
    when that changed, its earlier decision and what it was made on in `earlier`, beside a blank
    one for a person to fill in; dropped when the construct is gone, or this build or the earlier
    file holds its identity more than once. The file records them in `carriedFrom`, for the
    report. Never by place.

  It lists each that said something and did not carry, and why; the earlier file is read and never
  changed. An entry of the earlier file that says nothing is passed over. It refuses the decisions
  of another package, and a first-format file of another build, whose items are their places
  alone. It says how many entries are left to fill in.

- **A decision is taken** only when what it copied still matches the report, whatever the order
  of a rule's keys, and its `identity` is that of the construct the package holds at its `id`. One
  made on another reason, label, property, place, rule or construct was made on something else,
  and is not taken: it is decided again. Nor is one of an item the report does not list, or that
  takes no decision, one listed twice, one holding a key a decision does not take, such as a
  verdict, one whose owner, decision or reason is not text, a proposal's decision other than
  `accept` or `reject`, or an acceptance of a proposal of nothing to write. An item the report
  lists twice is its first entry's, as everywhere else. A file of another format, of another
  build, or with no list, is taken not at all, and a key of the file other than `format`, `package`,
  `decisions` and `carriedFrom`, such as an approval, is named. Each is a line of what stands in the
  way.
- **Readiness** then counts the reported items with no owner, and those whose owner says nothing
  decided; the proposals that wait, and those accepted or rejected with no one's name or no reason;
  and a conversion made with other decisions of its proposals than the file holds now. An owner, a
  decision or a reason of spaces alone is none.

**The approval** ([`src/approval.ts`](src/approval.ts)).
`approve <package> <conversion> --by <name>` records a person's approval of the report and its
decisions in the conversion's `approval.json`, in the provisional format
`studio-migration-approval/1`: who approved, when, the build, and the SHA-256 of `report.json`, of
`decisions.json` and of the conversion's other files, `app/` and `themes/` by path and bytes. The
first two are of each file as the tool reads it and writes it, two-space JSON, which is the file
byte for byte when the tool wrote it; so a change of what either says voids the approval, and its
spacing alone does not.

- **Readiness** needs an approval whose digests are those of the conversion as it is now, and of
  the package given. A decision filled in or changed, the conversion made again, a file edited by
  hand: each voids it, and the verdict and the report say which. It is never carried to another
  run.
- **No run of the tool approves itself.** `approve` is the only command that writes an approval,
  and no other runs it: `migrate`, for one package or many, never does. It refuses while a decision is still to
  make. It refuses to run where its input or output is not a terminal, as in a script, a pipeline
  or an agent's run, and asks the person named with `--by` to type back the first 8 characters of
  the digest it shows. It writes only an `approval.json` the conversion does not hold.
- **What it is not:** proof of who typed. Someone at a terminal, or a program driving one, can
  type any name, and `approval.json` is a file anyone who can write the conversion can write by
  hand, as `decisions.json` is; the approval is a record of who said they approved, as a signature
  on paper is, not a cryptographic one.

**The report** ([`src/report.ts`](src/report.ts)): `report <package> <conversion>` prints it, and
`--json` gives the same as data. It reads the package, the conversion, its decisions and its
approval, and writes nothing.

- **The header:** the package handed in and its version, the platform it targets, its bundle;
  Studio's branch, commit and build time, from its bundle's manifest; the app's id and platform
  range; the converter; the allow-list the harness held the actions to, and whether it is the
  deployment's, given with `--allow-list`, or the one the conversion recorded; and the approval, by
  whom and when, or why none holds. Whether the report is of that package is check 1's.
- **The summary:** the package's constructs, as the inventory reads them, by kind, with the outcome
  of each one's first entry in the report: how many are converted, proposed and of those accepted
  and rejected, reported and of those decided, generated, left on the server, pending, and missing
  from the report. An entry whose outcome is none is counted apart. The coverage is check 1's: the
  share of the constructs the report lists, rounded down to a tenth, so that 99.96% never reads as
  100%.
- **What the harness found:** the ten checks, and the verdict with what stands in its way.
- **The decisions needed:** every reported item, with its reason, where it was written, and its
  owner and decision, each or none; what was not taken from `decisions.json`; every proposal, with
  who accepted or rejected it and why, where an accepted one was written, or that it waits, or
  follows its condition's; and, for a file carried from another build, what was carried, each
  decision offered for re-confirmation with the earlier one, and each dropped, with why. What people
  and the package wrote is printed on one line each, a line break as `\n`, so that no owner's words
  can print a line of their own, such as an item that looks decided.
- **What the harness found, file by file:** each finding under the file it is of
  (`fileOfFinding`): the file of the conversion it starts by naming, as the checks write them,
  `layouts/…: …`, `app/labels/…: …`, a theme by its name; else a file of the package it names, as
  check 1's and check 5's own lines do; else none. Each file of the conversion is given with the
  package's files whose constructs it holds, from the report's `to`.
- **Each file of the package:** its constructs by outcome, where those converted went, and what the
  harness found in the files of the conversion they went to.

Screenshots and request logs are lab mode's, below, which writes them beside its own report; this
report does not take them in.

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
  pages: the document layouts Web UI loaded for the document's type, read with the inventory's
  markup reader and its idea of a condition, as a package's are read; the layout files the new app
  loaded for it; and which page the new app showed, with the `data-field` of each field on it. Never a credential, and of the document's
  answer only its properties' names; a query is kept as it was sent.
- **Read only.** A request either app sends is refused before it leaves the browser, and listed,
  unless it is a `GET`, `HEAD` or `OPTIONS`, or a `POST` of an operation that only reads: Web UI's
  sign-in (`login`), `Repository.Query`, `Repository.PageProvider`, `Directory.SuggestEntries`,
  `Audit.QueryWithPageProvider` and `NuxeoDrive.GetRoots`. Downloads (`@blob`, `@rendition`,
  `@preview`, `@convert`, `nxfile` and the like) are refused too: the server may write them to its
  audit log. So is the new app's sign-out as it starts, `/nuxeo/logout`, which ends a session on
  the server. From Node it only reads: `GET`s, each to the origin it is for, that follow no
  redirect, sending back the session the server opens, so that they sign in once.
- **As the same user.** Before anything opens, `/me` must answer as the user, judged by the Beta
  harness's identity guard (`judgeMe`). Web UI is sent the user's `Authorization` on every request
  to the server's origin, and nowhere else. The new app is given the session its sign-in writes,
  as `h.login()` writes it, before its first script runs, and every request it sends to Nuxeo must
  carry that header, but the configuration service's files, which it reads without the header by
  design. Each `/me` either app reads, and Web UI's sign-in, must name the user; a document where
  one does not is not compared, and the run exits 2. Web UI's requests carry the header because lab
  mode adds it, so for Web UI it is what `/me` and the sign-in answer that counts. Under
  automation, Web UI waits for an `automation-ready` event unless `window.automationReady` is set,
  so lab mode sets it.
- **The request-log rule** ([`src/lab.ts`](src/lab.ts)), check 7's server half on a document's
  page. The harness defined none before. For each document:
  1. **The document.** Web UI's page asks for it, with a `GET` by id or by path; the new app's must
     too, and be answered as Web UI was: both read it, or neither.
  2. **Its schemas.** Every schema Web UI asks for it with, `*` being every one, the new app asks
     for too, read as each browser sent the request. The new app's development server adds
     `X-NXproperties: *` to everything it proxies (`apps/nuxeo-ui/proxy.conf.json`), so there it
     receives every schema whatever it asks: only what it asks says what a server would send it.
  3. **Its properties: every property Web UI fetches and shows, the new app fetches and can
     show.** Web UI shows a property when a document layout it loaded for the document names it in
     a place outside every condition: a binding, `document.properties.<prefix>:<name>`, or an
     `xpath`, in a field or outside every field. Each place is decided on its own, so a field that
     shows one property to everyone and another only under a `dom-if` holds the first and lists
     the second; a condition's own test reads a value and shows none. Web UI fetched the property
     when its answer for the document holds it. The new app fetches it when an answer for the
     document it received holds it, and can show it when its page holds a field of it, when a
     `view` or `metadata` layout file it loaded for the type lists it, as on a tab not opened, or
     when its page draws it itself: the document page's Properties panel, or the info panel of
     Browse, where the new app opens a folder (`DRAWN_BY_THE_PAGE`). That table is a copy of those
     components, which `lab.spec.ts` holds to their source files. The page is told apart by its
     header naming the document: the document page draws its header only once it has read the
     document, and Browse's header names the folder only once it has it. Listed, not held: a
     property named only under a condition, since whether it shows is the condition's, which check
     5 holds; and a field that names no property, such as Web UI's viewer or its attachments, whose
     property lab mode cannot read from the layout.

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
- **Not compared is never a pass.** A document is not compared when Web UI never asked for it;
  when either page was still sending at the end of lab mode's wait; or when lab mode could not read
  a layout either app asked for, an answer for the document as the document, or the new app's
  page. Held to less than what each showed, the rule could pass where it should not. Its checks
  say why, and the run exits 1.
- **Exit codes:** 0, every document compared, none differs and no check failed; 1, a difference, a
  failed check, a document not compared, or something could not be read or written; 2, the command
  was wrong, or the environment is: the credentials, Playwright, a server that does not answer as
  the user, or a document that could not be compared as the user. A control run's is the
  control's, below.

**Its controls**, `--control`, each put into the new app's side alone, in the browser, for the
rule to report:

| Control                           | Breaks                                                                   | The rule must report                           |
| --------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| `withhold-property=<prefix:name>` | Takes the property out of every answer for the document the new app gets | Web UI shows it; the new app does not fetch it |
| `narrow-schemas=<schema,...>`     | Makes the new app ask for the document with those schemas alone          | A schema Web UI asks for that it does not      |

A control is reported only by the finding it causes, never by another difference of the same
document, and a control run exits 0 once the rule reported it on a document, and 1 when it reported
it on none: either it had nothing to break there, such as a property Web UI does not show, or the
rule missed it.

**On the local server**, 25 and 26 November 2026, before and after the review below: Nuxeo LTS 2025.10.18 in Docker, with Web UI at
`/nuxeo/ui/`, and the new app's development server on port 4297 serving the Payers kit's files; as
the administrator, on a File, a Folder, a Note and a Payers Member:

- **The Folder differs, five times.** Web UI's folder metadata layout, under its Details, shows
  the description, nature, subjects, coverage and expiry date. The new app opens a folder in
  Browse, whose info panel shows none of them. The other three documents do not differ.
- **The Member:** Web UI has no layout for Member, as nothing installed gives it one (both answered
  404), so the rule holds none of its properties. Web UI's page still shows its own info rows, of
  state, dates and people, which the rule does not hold yet.
- **Web UI's viewers and attachments** name no property in its stock layouts, and are listed, not
  held: the File's `nuxeo-document-viewer` and the Note's `nuxeo-note-editor`, and each one's
  `nuxeo-document-attachments`.
- **Listed:** on the File, the Note and the Member, Web UI asks for the document with eleven
  enrichers the new app does not, `audit`, `breadcrumb` and `pendingTasks` among them, and the new
  app with two Web UI does not, `acls` and `allowedTransitions`; on the Folder, nine and three.
  Lab mode refused Web UI's `User.GetUserWorkspace`, which creates the user's workspace when there
  is none, both apps' downloads of the file and of a thumbnail, and, since the review, the new
  app's sign-out. Nothing was written to the documents: none of the four documents' audit trails
  holds an entry from the days of the runs, where earlier days' hold `download` entries, the kind
  lab mode refuses to cause. Whether the server records each sign-in in its authentication log was
  not checked; each browser keeps one session, and the Node reads, since the review, one between
  them.
- **The controls, each seen reported**, on the Note: `withhold-property=dc:description`, as "Web
  UI shows dc:description (nuxeo-note-metadata-layout.html); the new app does not fetch it"; and
  `narrow-schemas=dublincore`, as "Web UI asks for the document with every schema (\*), the new app
  only with dublincore". Each exited 0. The second was not also reported as a property the new app
  did not fetch: the proxy's `X-NXproperties: *` still brought it every schema, which is why the
  rule's second part reads what the browser sent. `withhold-property=member:email` on the Note,
  which Web UI does not show, was reported on none, and exited 1.
- **The made-up Acme-Claims package with M2's corpus**, and its conversion: check 3 confirmed
  `dc:title` on the server, and failed on "the server has no vocabulary claim_decision", which the
  package names and does not define. Web UI serves none of its 21 files and the new app none of
  its 6 layout files as they are held, so checks 5, 6 and 7 said they need the package installed
  and the conversion served.

**A layout of the new app that leaves out a property Web UI shows** is reported: `lab.spec.ts`
holds it. On this server it cannot be seen live: the fields of Web UI's stock layouts name Dublin
Core and a note's format alone, which the new app's Properties panel draws whatever its layout
files say. It needs a package's Web UI layouts on the server, as the lab server will have them.

## The code track (M3)

Migration M3 (the migration document, sections 4 to 7): each custom element of a package becomes a
Layer 2 Angular plugin, written by an agent, held to the element by check 9, and accepted by a
person. **Built and checked on two made-up elements only, with no real package.** Until decision
5's spike proves signed, pinned plugins loaded at run time, a plugin is built into the customer's
app from the template, as every customer library is today: nothing here loads code at run time.

1. **The inventory describes each element** ([`src/elements.ts`](src/elements.ts)). A custom
   element is a `dom-module` of the custom bundle, `nuxeo-<project>-custom-bundle.html`, that holds
   a script. Read from the parsed markup and the script's syntax tree, and never run: its
   properties, with their types and defaults; its behaviours and the methods it calls on itself;
   its template's bindings, the document properties they read, its conditions and the elements it
   uses; its listeners; the events it fires with `this.fire` or `new CustomEvent`; the operations
   its `nuxeo-operation` and `nuxeo-operation-button` run; its texts; where the package uses it;
   and the SHA-256 of what it reaches in the package: its definition, the custom bundle's code outside its elements and slot contributions, where a behaviour or a mixin it uses is defined, and the files of the package either names in a `src` or an `href`, read once and not followed further. `inventory` prints it under "Custom elements". What an
   element holds is the element's: its scripts and conditions are not among the file's, and both
   counts of check 1 count the element whole.
2. **The report proposes each element as its plugin** ([`src/convert-elements.ts`](src/convert-elements.ts)),
   a construct `custom-element:<file>#<n>`, `proposed`, with the plugin's library,
   `libs/extensions/<element>`, as where it goes. It is a proposal as a condition's rule is
   (**The report**, above): a person accepts or rejects it in `decisions.json`, with their name and
   reason, held to the element by its identity, of that SHA-256, and the report
   records what the conversion was made with, `applied`. Accepting it writes nothing of the
   conversion. Readiness waits for the decision, so a plugin that passes check 9 is not ready on
   that alone, and a decision is carried to a new build only while what the element reaches in the package is the same: what it reaches beyond it, Web UI's own behaviours, is not in it.
   `approve` records, beside the report's digests, the SHA-256 of every file of each accepted
   plugin's library, `studio-plugin.json` among them, read from this repository or the one
   `--plugins` names: a plugin changed after the approval voids it. A contribution that holds a custom
   element in a document's actions is reported: an app's toolbar draws actions, not components, so
   where the plugin shows is a person's call. The custom bundle's other code, and customer code in
   a file Studio generates, are reported: M3 writes plugins of elements only.
3. **`plugin` scaffolds the library** ([`src/plugin.ts`](src/plugin.ts)): it runs
   `nx g ./tools/satori-generators:extension-library`, the template every customer's Layer 2
   library comes from, then writes over its samples the element's component, registered by ID
   behind a lazy import, with an `input()` per property and an `output()` per event; a spec skeleton
   with an `it.todo` per behaviour the inventory read; the element's texts in the package's own
   language; a README quoting the element; and `studio-plugin.json`, which names the element, the
   package, the definition it was written from, the component and the provider. It refuses an
   element the package does not define, and a library already there. It writes no behaviour.
   `plugin … --restamp` records anew, in an existing plugin, the element's definition as the package
   given holds it, for a person who has changed the plugin to follow a changed element.
4. **The Code agent finishes it,** following [`.cursor/skills/studio-plugin/SKILL.md`](../../.cursor/skills/studio-plugin/SKILL.md):
   the repository's conventions, the app's services only, a test of each behaviour, and never any
   code in configuration. Then it adds the provider to the template's `app.config.ts`.
5. **Check 9** ([`src/check-plugins.ts`](src/check-plugins.ts), [`src/plugin-scan.ts`](src/plugin-scan.ts),
   [`src/plugin-run.ts`](src/plugin-run.ts)) holds each plugin to its element:
   - **the report** lists the element as its plugin, a proposal a person decides, at its library;
     a rejected plugin is not held to its element, and its library must be gone;
   - **the plugin** is the element's, from its definition as the package holds it now, with its
     interface, built into the template app from its own library, as the template's `tsconfig.app.json` resolves its import path, with no directory check 9 does not read, `node_modules` or `.git`, with the template's build and test configuration, a
     test of every behaviour the inventory read or a reason in its README's "Not kept";
   - **a scan** of its shipped code finds no data written as HTML, no sanitiser bypassed, no text
     run as code, no URL bound to `[src]` that is not a blob URL it revokes, no Nuxeo URL in a
     `src`, no network but through the app's services, no other origin, no browser storage, no code
     run at start-up, no global reached by a computed name, no built-in changed, no import outside
     Angular, RxJS, the platform's published entry points and its own files, and the repository's
     conventions kept; its public API exports no class and no type of another package; and no
     string of the conversion's app definition or of `studio-plugin.json` holds code;
   - **run** (`--run-plugins`): its own tests pass, from a copy of its files with the template's
     configuration and the harness's own setup, which fails a test that asserts nothing; a passing
     test of every behaviour the inventory read, by its title, as Vitest ran it; none left `todo`,
     skipped, or taken away, and no file of them running none; lint, test and typecheck of the
     library, and build of the template app, pass through Nx, once the library on disk is the files
     the check read, its `project.json` the generator's; and the platform's customer guardrail,
     `libs/platform/guardrails/check-extension-library.mjs`, passes on its files;
   - **its values** (`--observed`): the harness's own spec, written into the copy and into nothing
     of the plugin, registers the plugin through its provider, resolves its component by ID, shows
     it each record of the observed behaviour with the record and the inputs the file gives, and
     compares the text it shows, each piece with one space between, as check 6 compares labels; the
     requests it sends and the outputs it emits as it is drawn; that every button it shows is
     pressed by the file; and, pressing each, the requests until it settles, the operation, its
     input (`doc:<uid>` and the uid alone being one document) and its parameters, and the outputs
     emitted, a detail of none being `{}` as Polymer fires it. Whenever the plugin runs, what
     registering and drawing it added to the app's registries is held to its one component. An
     input the file never gives a value leaves the check in part.
6. **The observed behaviour** ([`src/observed.ts`](src/observed.ts)), `studio-migration-observed/1`,
   is records as Nuxeo's REST API returns them and, for each element, what it shows on each and
   what pressing it asks and fires. For a real package it would be read from Web UI on the
   migration server, which lab mode does not do yet. The made-up corpus's was worked out by hand
   from each element's code.

**On the made-up corpus** ([`src/testing/m3-corpus.ts`](src/testing/m3-corpus.ts)): two elements,
`acme-claim-exposure`, which shows a claim's properties computed, and `acme-claim-escalate`, a
button that runs `Claim.Escalate` and fires `claim-escalated`, `document-updated` or `notify`. The
`plugin` command wrote `libs/extensions/acme-claim-exposure` and `libs/extensions/acme-claim-escalate`,
which were then finished with the skill and built into `apps/nuxeo-satori-template`.

- **In the tests:** both plugins run, their own tests and the harness's spec, and check 9 finds
  nothing, `partial` only because lint, build and typecheck do not run there. Every control fails it.
- **By hand, on 27 November 2026:** `check --run-plugins --observed`, on the corpus's package, its
  conversion and its observed behaviour, ran both plugins' gates through Nx too, and check 9 passed
  on both. That run is not repeated by any test or CI job: CI runs the plugins' lint, test, build
  and typecheck as the repository's gates, and the tests above.
- **One thing shown differently:** the escalate element's `notify` was a toast in Web UI; a slot
  binds none of the plugin's outputs and the template app has no toast, so the plugin shows the
  message beside its button. Its README says so.

**What it does not do:**

- **No real package.** No custom element of a real package has been migrated, so neither has the
  phase 6 demo's "custom element from a real package". Real elements will hold what these two do
  not: Polymer 3 classes, imports of other files, behaviours of their own, elements nested in one
  another.
- **Run-time loading** waits for decision 5's spike and its owners; the plugin is built in.
- **Placing a plugin** is a person's, as they accept it: the conversion writes no manifest entry for
  it, and the record page's layout file holds no component.
- **The template's own configuration** is not in the approval: it covers each accepted plugin's
  library, and check 9 holds the template to build each accepted plugin in, from its own library as `tsconfig.app.json` resolves its import path, and a rejected plugin's library to be gone from the repository. Check 9 reads no other file of the template app: the rest of the fork is the customer's own code, which their review holds.
- **The observed behaviour of a real element** needs Web UI on the migration server.
- **Another language** than the package's own: the plugin carries its element's texts in that
  language, since the template provides no translation service.
- **The scan is a tripwire, not a proof.** Code that hides what it does can pass it, and the
  harness's spec and the plugin share a page. It reads the syntax, not the types: a type inferred
  from a value is held by asking that its type be written. A person reviews every plugin before
  accepting it.
- **The values half compares text, requests and outputs,** not attributes, styles or what a style
  hides: a tooltip, an icon's name or a value hidden by CSS is the reviewer's. It holds the plugin
  only on the records and inputs the observed behaviour gives.
- **Overrides of the platform's own registrations** are held by the scan, which allows only
  `provideSatoriExtensions({ components })` and no registry elsewhere; the run sees only what is
  added, by ID.

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

  For M3, [`m3-corpus.ts`](src/testing/m3-corpus.ts) adds two made-up custom elements to the
  custom bundle, one used in the Claim's view layout and one among a document's actions, four
  records of the Claim type, and what each element shows on them and asks the server, worked out
  by hand (above, **The code track**).

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

- **For many packages in one run, 16 guards**, broken one at a time by a script that runs
  `batch.spec.ts` and restores the file, each seen turning it red: letting an unreadable folder
  throw; stopping at the first package that stops; exiting with the best result rather than the
  worst; running the same package again; telling folder names apart by case; keeping a name
  Windows keeps for a device, and the dots it drops from a name's end; counting a package's
  constructs from its first kind rather than the report's `all`; carrying by build alone rather
  than first by bytes, carrying the first folder of a build held twice, and never carrying by
  build; saying "Carried" whatever step the run stopped at; reading a package again for its run;
  leaving the allow-list out of each package's run; letting a defect of one package's run end the
  whole run; and never letting the event loop turn between packages. Two were missed at first and
  have their tests now: no test gave the batch an allow-list, and the only test of a defect threw
  inside a step, which the run of one package already catches, so removing the batch's own catch
  changed nothing; an independent review found the second. Its second round found that matching
  by build alone let one build held twice carry the first one's decisions into both, and that
  "Carried" was said of a run that stopped first.
- **The single-package golden was seen failing:** one space added to `migrate`'s verdict line
  turned seven of its scenarios red, and the refusals, which print no verdict, stayed green. The
  review ran it against the code of `staging/enterprise-grade-app` before the batch, where it
  passed, and saw it fail there too, on another line.
- **The support playbook's coverage, 6 guards**, each seen turning `playbook.spec.ts` red: the
  tool gaining a finding the playbook does not hold; a finding built in a way the scanner cannot
  read as text; a new file of the tool adding findings with no section; the playbook losing a
  row; the playbook holding a row the tool cannot print; and a row naming no one to act. The
  scanner's own tests hold each way it reads a finding on a made-up source. Writing the playbook
  found two findings the first scanner had not read: check 10's `sections must be a list`, returned
  rather than pushed, and lab mode's `the platform's model could not be read: …`, returned to
  another file. The review found nine more ways past it: a line pushed to the verdict's `blockers`
  or the inventory's `decisions` after they are built, `unshift`, an index, a list of its own
  spread into one, a helper's list of another name, `x.findings.push`, a `findings` that is another
  list, and a check in a folder. Its second round found four more: a list given to a helper, a
  list made again, new words in a constant part of a text, and a problem given in shorthand. It
  reads each now, and its tests hold them; reading constant parts changed one row, which now names
  `studio-migration-decisions/1`. Words inside a part that is not a constant, such as one of two
  chosen as it runs, are still `…`, and the playbook's section 10 says so.
- **For lab mode, 72 guards**, broken one at a time by a script, kept outside the repository, that
  runs its four specs and restores the file, each seen turning them red:
  - **The rule:** a field under a condition not held, and only what Web UI fetched; a property
    the new app does not fetch, or cannot show; the page's fields, a `view` or `metadata` layout
    file it loaded, and the rows the page draws itself, each as what it can show; the schemas,
    every one and by name; a new app that never asks, or is answered otherwise; Web UI never
    asking; identity, what could not be read, and a page still sending; a read by path; in Web
    UI's layouts, each place decided under a condition or not, a condition's own test, a property
    named only under one listed, an `xpath`, a property named outside every field, a template's
    content, and a field naming none listed; the servlet's envelope; a Web UI layout that did not
    load.
  - **The browser:** downloads through the API and through the servlets, and the new app's
    sign-out; only reads, and only the operations that only read, by `POST`; the header to the
    server's origin alone; controls on the new app alone; an unsigned request, to Nuxeo and not
    only its API, but for the configuration service's files; an answer naming another, and none
    naming the user; a refused request recorded; a layout and a page that could not be read, an
    answer for the document that is not the document, and a layout that failed, kept as such, but
    for the new app's forms; the document page and Browse each told by its header naming the
    document.
  - **The server's reads:** one origin, no redirect, the session sent back; a field, a widget's
    type and a type's schemas, a vocabulary, a page provider and a task's variable, each against
    the server's model; a model that cannot be read; the package byte for byte, and the conversion
    as JSON.
  - **The command:** the credentials, a new or empty `--out`, who the credentials are, exit 2 on
    identity and 1 on a difference or a document not compared, a control's exit and its own
    finding, for the schemas the control gave and left out too, the package installed and the
    conversion served, and check 3 failing.

  Seven rounds ran. The first, of 46, found three no test reached: a field on the new app's page
  that no layout file lists, as its generated layout shows one; a layout Web UI was refused whose
  answer has a body; and the control kept to the new app, which a second test of the same thing
  hid, now gone. The script did not find a fourth, whose text formatting had changed. The second
  round found that one reached by no test either, the package served without its conversion. Each
  now has its test, and the third round found none. `pre-pr-review.mjs` then found two empty
  `.catch()`es: a layout whose answer could not be read was dropped, which would have made what
  Web UI shows look smaller, and so held less. Each is now kept as unreadable, which stops the
  document's comparison and exits 1. Reading the code against the Beta harness then found the
  identity check judging Nuxeo's API alone, where that harness judges every request to Nuxeo but
  the configuration service's files; it now does too. The fourth round, with the six guards those
  brought, found none. The fifth, of 66, after the review below, found a control counted by another
  property's finding of the same kind, which now has its test, and a check of a refused Web UI
  layout that a second one hid, now gone; the script did not find a third, whose text formatting
  had changed. The sixth found none. The seventh, of 72, after the review's second round, found a
  `narrow-schemas` control counted by a missing schema it had given itself, which now has its
  test; the script did not find two whose formatting had changed, which were then run alone and
  turned the suite red. A spec drives `recordApp` through a small stand-in for Playwright, so the
  browser half is held too: what is refused, sent and recorded. The script lab mode sends the new
  app's page to tell it apart is run in jsdom on each state the page draws.

- **An independent review of lab mode**, by a reviewer given the diff and the `pre-pr-review`
  skill, found twelve things. Fixed, each with a test:
  - two false passes: a read of the document Web UI could not read as the document held the rule
    to no property, and a page still sending at the end of the wait was compared on what it had
    sent; each now stops the document's comparison;
  - a layout request that failed was dropped rather than kept as unreadable;
  - a Web UI field was read by its first binding alone, so a second binding, and a property named
    in an `xpath`, were never held; each is now, and a field naming none is listed;
  - a control was counted by any difference, so a missed control could exit 0: it is now counted
    by its own finding, and a control run exits by it;
  - the new app's page was told apart by its host element, there in its loading and error states
    too: it is now told by what each page draws once the document is open;
  - the drift test read the Properties panel's code and not its template, which now it does;
  - a form's layout file counted as one the document's page can show;
  - the new app's sign-out at start, which ends a session on the server, was let through;
  - the Node reads signed in once per read, keeping no session;
  - stale prose, in the guide and check 3's printed reason.

  Explained rather than changed: what Web UI's page draws outside its layouts, its info rows and
  the property a viewer shows by default, is not held (**Not done yet**); and whether the server
  records each sign-in in an authentication log was not checked, which the README now says.

  **A second round** found seven of the twelve fixed and five in part, and five more things.
  Fixed, each with a test:
  - a property took its field's conditions, so a field showing one property to everyone and
    another under a `dom-if` held neither, a false pass the first fix had widened to every binding:
    each place is now decided on its own;
  - Browse was told apart by a button it draws before it has its folder: each page is now told by
    its header naming the document;
  - a failed form layout of the new app stopped the comparison, though a form shows nothing on the
    page;
  - a `narrow-schemas` control was counted by any schema finding, not one of the schemas it gave
    or left out;
  - a property named outside every field was neither held nor listed: it is now held.

  Checked rather than changed: the reviewer suspected that a change to the components the drift
  test reads would not make this tool affected, so CI would not run it. Nx counts a target's
  inputs as making the project affected: `nx show projects --affected --files=…` lists this tool
  for `browse.html`, which is an input, and not for `browse.scss`, which is not. The template the
  test now reads was added to the inputs.

- **For proposals, carrying and the approval, 41 guards**, broken one at a time by a script kept
  outside the repository that runs the specs meant to catch each and restores the file, each seen
  turning them red:
  - **Proposals:** an accepted verdict writing the rule, and only on the rule proposed now; the
    checks reading the decisions; a proposal decided by someone named, for a reason; one of nothing
    to write refused acceptance; what a proposal guards taking no decision; a conversion made with
    other decisions said so; check 5 holding a field under an accepted rule to be there; `convert`
    writing what was accepted, and `migrate --from` converting with it.
  - **Carrying:** a decision held to its construct's identity; a changed construct offered, not
    carried; a construct held twice, and an identity decided twice, carrying nothing; a repeated
    card told from the card it repeats; another package refused before writing; a batch carrying
    a new build by its package's name.
  - **The approval:** readiness needing one; held to the report, the decisions, the files and the
    package given; `approve` needing a terminal, the digest typed back, every decision made and a
    name; the real shell giving it no terminal without one.
  - **The report:** counting accepted and rejected proposals, and putting findings under the file
    they name.

  The first round, of 30, found two that left the specs green. One, a verdict on another rule than
  the proposal's, has its test now. The other, a follower proposal counted as waiting in
  `holdDecisions`, was a second layer behind `readDecisions`, which takes no decision of one, so it
  could turn nothing red alone: it was removed. The second round, of 41, after the reviews' fixes
  (below), found two more: a refused file's record of what it carried shown in the report, and an
  offered proposal counted as confirmed whatever it was decided. Each has its test now, and the
  report also says what an earlier run of the same build offers again, which it had left out.
  The 41 add to those above: the report held to the converter; the checks held to the decisions
  the report records; names of a letter or a digit; the earlier build's own shared identities;
  offers kept, and what was carried kept, on a run of the same build; a batch carrying by name only
  from a file of identities; and the controls picking what they break. After the reviews' second
  rounds, three more, broken the same way, each turned the specs red: a Hangul filler naming no one,
  and an offer no one confirmed offered again, as it was offered, on another build and on the same
  one.

- **Two independent reviews of this slice**, by reviewers given the diff and what it is for, one
  for correctness and one adversarial, asking whether a conversion nobody approved, or a proposal
  nobody accepted, could reach readiness.
  - **The adversarial review** found one hole, reproduced with the commands: relabelling the
    proposals in `report.json`, as `converted` say, took every proposal off the verdict, and with a
    hand-written `approval.json` every line that needs a person went too. Fixed: readiness converts
    the package again with the allow-list and the decisions the report records, and names a report
    that says otherwise of any construct (`reportDiffers`), which closes the same door for a
    reported item relabelled to hide it. It found weaknesses too. Fixed, each with a test: a name,
    a decision or a reason of characters that show nothing, such as a zero-width space, was taken
    as a name; an identity the earlier build held twice still carried when only one of them was
    decided, which its file now names (`shared`), and decisions of one identity are counted, said
    something or not. Explained, under **Not done yet**: a decision rests on its entry and its
    construct, so a layout host whose script changes keeps the acceptance, though the script then
    stands in the way as customer code; an accepted rule is written on what its condition guards in
    the new build; and `approval.json` is a file anyone who can write the conversion can write.
  - **The correctness review** found, reproduced: a batch `--from` a run of the earlier format
    stopped every package of another build of the same name, now carried by name only from a file
    of the second format; check 5 failed a conversion made before its decisions were filled in,
    where the guide says to look at a run with `check`, now the checks hold the conversion to the
    decisions its report records and readiness holds those to `decisions.json`; an offer for
    re-confirmation was lost on a second run of the same build, and what had been carried with it,
    now both kept; the count of proposals waiting took in what a proposal guards, which no one can
    decide, and read "1 proposals wait"; and the migration document said an agent's run could not
    approve, though the reviewer approved with a program driving a terminal, as the README said it
    could. Suspected, and fixed: an offered proposal counted as confirmed whatever it was decided;
    a refused file's record of a carry shown in the report; and `drop-accepted-proposal` claiming
    check 5 where an accepted proposal guards only an action, which is check 7's, so the control
    now picks a field and a test holds the action to check 7.
- **A second round of the adversarial review**, on the fixes, found relabelling `report.json`, an
  earlier build's shared identity, forging `applied` with `decisions.json`, relabelling while
  editing the app files and an id listed twice each still in the way of readiness, by a check or a
  line of the verdict. It found one more weakness, fixed with a test: three Hangul fillers are
  Unicode letters that show nothing, and named someone; they name no one now. Left as it is: an
  earlier build's file edited by hand, its `shared` and its twin entry taken out, carries what a
  carry cannot check without that build's package.
- **A second round of the correctness review** confirmed the eight fixed, and found that the third:
  keeping an offer on a run of the same build, let it pass as an ordinary decision on to a third
  build, where a blank was counted carried and the earlier decision lost. Fixed, with tests: an offer
  no one confirmed is offered again on any later run, as it was offered, and is not counted carried.
  It also found a count of the controls one too many in the migration document, now seven. It ran
  `migrate` 32 times on the made-up packages and a new build, fresh and with `--from`, accepted and
  rejected, and the readiness line that holds the report to the converter never fired on a run the
  tool wrote. Noted rather than changed: readiness converts the package once more for that, about
  17 ms on the made-up package with M2's corpus, against 158 ms for the harness.
- **End to end, in a shell,** on the made-up packages, 27 November 2026: `migrate` of Acme-Claims
  with and without M2's corpus, with and without the allow-list, its decisions filled in, the
  proposals accepted, and run again with `--from`, which wrote each accepted rule and left nothing
  of the decisions in the way but the approval; the proposals rejected and carried, which wrote
  none of them; a new build of the package, another commit in its manifest, carrying every decision
  by identity; `--from` another package, refused with nothing written; several packages, filled in
  and run again with `--from`, each carrying its own; a new build among several, carried by its
  package's name from a run that held one build of it, and carried nothing from a run that held
  two, saying so; and `approve`, refused in that shell, which is no terminal, with nothing written.
  The packages' bytes were the same after every run. No real package was run, and no reviewer
  approved a report by hand.

## Not done yet

- **The rest of migration M4:** the upload, which validates a package sent to a service and returns
  its report. `migrate` runs on a copy of this repository, so a customer needs `npm ci`, and with
  it a read token for the Hyland packages on GitHub Packages. Many packages in one run, and the
  support playbook, ran on the made-up packages only.
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
- **What Web UI's page draws outside its layouts** is not held: its info rows of state, dates and
  people, and the property a viewer or attachments element shows by default. Holding them needs a
  table of Web UI's own elements, whose sources are not in this repository.
- **A tab on several types, one of whose view layouts shows only the preview,** makes check 2 fail
  on a fresh run: the converter writes the tab for the other types and reports it, and the check's
  places (`formPlaces`, in `src/forms.ts`) still hold the type whose view it wrote no file for to
  the tab, as `…: … is missing, though … shows it`. Found while writing the support playbook, with
  a made-up package; not fixed here, and the playbook names it.
- **The rest of M3, the code track** (above): real packages' elements, the observed behaviour read
  from Web UI, a plugin's placement, run-time loading after decision 5, and other languages.
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
- **A card an operation feeds,** such as the favourites card, proposes nothing the converter can
  write: no queue takes the list an operation gives, and `home.json` has no card for a user's
  favourites. It can be rejected, and not accepted, until the mapping agent proposes a target.
- **Tidy labels as proposals.** A machine-generated label, such as "Hfs Fields Hfs S Object Id", is
  named in a reported search field's note, and no tidy one is proposed: a tidy label would need
  check 6 to take a label a person accepted where Web UI's differs.
- **The approval is no signature.** It records who said they approved, at a terminal; it proves
  neither who typed nor that a person did, as a cryptographic signature would. A program that
  drives a terminal can approve. What it guards against is a run approving itself unwatched.
- **Per-file findings are found by their words.** A finding is put under the file it starts by
  naming, as the checks write them, or a package file it names: a finding worded otherwise would be
  of no one file. The tests hold every finding of every control to a file, so a check whose wording
  changes is seen there.
- **What a decision rests on, beyond its entry.** A decision is held to what its entry copies
  from the report, and to its construct's identity. What else it rests on is not held: a condition's
  proposal rests on the layout's host having Web UI's filter function, and a host whose script
  changes to define it otherwise keeps the acceptance, though its script then is customer code,
  pending, which stands in the way of readiness; and a condition's accepted rule is written on what
  the condition guards in the new build, which may be another field.
- **Identities across real builds.** A construct's identity holds its file's path, which Studio
  names after a layout's type and mode, a search's provider, a workflow and step; a project that
  renames one gets a new identity for everything in it, so its decisions are dropped, never carried
  to another construct. Two builds of one real project would show how often that happens.
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
    each such script is customer code, reported, until it does;
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
