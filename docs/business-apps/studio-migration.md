# Migrating Web UI customisations from Studio Designer

How a customer's Web UI, configured in Nuxeo Studio Designer as Polymer files, moves to the new
app, with AI agents doing the conversion and a harness proving that nothing was lost.

Written on 21 November 2026 from a sample Studio package (project `Nuxeo-Satori`, LTS 2025), the
Studio parity plan and its decisions of 19 November, a document that is not in this repository,
and the [architecture](architecture.md). Everything about the sample was read from its files, and nothing
in it was run. The rest is a proposal.

## The short version

- **Most Nuxeo customers configure Web UI in Studio, and today there is no way across.** The
  [Web UI comparison](../../documentation/20-product/06-nuxeo-web-ui-comparison.md) lists the
  migration path as not verified: nothing in this repository addresses it.
- **A Studio package holds two things:** the data model (types, schemas, lifecycles, page
  providers) and the Web UI files (Polymer layouts, slot contributions, a theme, a dashboard,
  translations). The model needs no conversion, because the new app reads it from the server.
  Only the UI files are converted.
- **So a customer migrates without a big bang.** Web UI and the new app read the same model on
  the same server, side by side. Users move app by app.
- **Customers hand over their package as they have it:** the Marketplace package Studio builds,
  or the Git repository of the generated UI files. A customer that already writes configuration
  packages for the new app hands those over too.
- **Conversion is deterministic first, AI second.** The generated files are highly regular, so a
  parser and a mapping table convert most of them. Agents handle what a table cannot: ambiguous
  bindings, labels to tidy, custom elements, and the explanations in the report.
- **A harness proves each conversion.** It checks that every field, label, slot, condition and
  operation is accounted for, and runs both UIs on the same documents to compare what people see
  and what the server is asked to do. A deliberately broken conversion must fail it.
- **Free code does not migrate as code.** Custom elements become Layer 2 Angular plugins, written
  by an agent, verified by the harness and reviewed by a person. Free JavaScript conditions become
  structured rules, or are reported. This follows parity decision 2: no free code in configuration.

## 1. What customers hand over

| Input                                   | What it is                                                                                                    | What we take from it                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| The Studio Marketplace package          | The zip Studio builds: `package.xml`, `install.xml`, `studio-registries.json` and the project bundle (`.jar`) | Everything below; the bundle's manifest gives Studio's Git branch and commit for the report |
| Git access to the generated UI files    | Studio exposes the generated UI as a Git repository (parity plan, capability D14)                             | The same UI files, with their history                                                       |
| A server running the package            | The customer's development or staging server, or a demo server with the package installed                     | The model as the server reports it, sample documents, and Web UI itself, for the harness    |
| A configuration package for the new app | A package the customer wrote for this app (the format of `tools/satori-generators`)                           | Validated by the same pipeline, and checked against Web UI where both exist                 |

Customer packages are data to read, never code to run: each is unpacked into an empty folder of
its own, nothing inside it is executed, and the server runs it only where it is already installed.

## 2. What a Studio package contains

Read from the sample, a small project with two business types and one search screen. The package
zip holds four files; the bundle holds 36.

| Part               | In the sample                                                                                                                                                                                          | Where                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Package descriptor | Type `studio`, target LTS `[2025.0,2026)`, depends on `nuxeo-web-ui`                                                                                                                                   | `package.xml`                              |
| Install            | Copies the bundle into the server's bundles                                                                                                                                                            | `install.xml`                              |
| Deployment         | Copies `web/nuxeo.war` into the web application and appends the translations to Web UI's catalogue                                                                                                     | `OSGI-INF/deployment-fragment.xml`         |
| Model              | 2 business types (`AdmissionForm`, `SampleTestDocu`, both extending `File`), 6 schemas with prefixes, allowed subtypes added to `Folder`, `Workspace`, `Document` and `File`, a lifecycle contribution | `OSGI-INF/extensions.xml`, `data/schemas/` |
| Page providers     | `GetAdmissionForms` (a query with 3 predicates and 8 sorts) and `claim_test` (a search-service provider), each with its search type                                                                    | `OSGI-INF/extensions.xml`                  |
| Document layouts   | 10 files: 2 types × 5 modes (create, edit, import, metadata, view)                                                                                                                                     | `web/nuxeo.war/ui/document/<type>/`        |
| Search screen      | A form and a results layout with three views (data table, thumbnail grid, justified grid), columns and sort options                                                                                    | `web/nuxeo.war/ui/search/<provider>/`      |
| Slot contributions | 4: a button in `DOCUMENT_ACTIONS`, a menu entry in `DRAWER_ITEMS`, its search page in `DRAWER_PAGES`, a theme in `THEMES`                                                                              | `ui/nuxeo-<project>-bundle.html`           |
| Custom code        | None: the custom bundle holds only its header comment                                                                                                                                                  | `ui/nuxeo-<project>-custom-bundle.html`    |
| Dashboard          | A replacement home with 5 cards: latest edited documents (twice), tasks, recently viewed, favourites                                                                                                   | `ui/nuxeo-home.html`                       |
| Theme              | 105 custom properties, 52 of them Web UI's `--nuxeo-*` and 53 Polymer's (42 `--paper-*`), and a logo                                                                                                   | `ui/themes/<name>/`                        |
| Translations       | 13 keys in `messages.json` (type, schema field and search labels) and a `messages.properties` for the old JSF UI                                                                                       | `data/i18n/`                               |
| Images             | An image the model names as `AdmissionForm`'s type icon                                                                                                                                                | `web/nuxeo.war/img/`                       |
| Studio's own model | Types, schemas and page providers in Studio's XML; its layouts are Modeler's JSF-era layouts, not the Web UI ones                                                                                      | `.metadata/`                               |

**Elements used**, 27 distinct besides the two wrappers every file has (`dom-module` and
`custom-style`), by count: `nuxeo-input` (31), `nuxeo-data-table-column` (15),
`nuxeo-data-table`, `nuxeo-date-picker`, `nuxeo-card` and `nuxeo-document-thumbnail` (5 each),
`nuxeo-user-tag`, `nuxeo-slot-content`, `nuxeo-page-provider` and `nuxeo-date` (4 each),
`nuxeo-user-suggestion` and `nuxeo-directory-suggestion` (3 each), `nuxeo-document-viewer` (2),
and one each of `nuxeo-search-form`, `nuxeo-results`, `nuxeo-data-grid`, `nuxeo-justified-grid`,
`nuxeo-operation-button`, `nuxeo-menu-icon`, `nuxeo-tasks-list`, `nuxeo-document-storage`,
`nuxeo-theme`, `nuxeo-document-grid-thumbnail`, `nuxeo-justified-grid-item`, `nuxeo-operation`,
`nuxeo-page` and `nuxeo-tag`. Every layout is a Polymer `dom-module` annotated with its document
type (`@doctype AdmissionForm`) or page provider (`@search GetAdmissionForms`), and binds fields as
`document.properties.<prefix>:<field>` on elements marked `role="widget"`. A search form binds
`params.<name>` instead, and its results layout carries no annotation of its own.

The figures in this section are what the `inventory` command of
[`tools/studio-migration`](../../tools/studio-migration/README.md) reads from the package.

**What the sample teaches, beyond the format:**

- **Studio's generated script is boilerplate, not customer code.** Every layout carries the same
  `Polymer({ is, behaviors: [Nuxeo.LayoutBehavior] })` block, and the results layout adds sort
  options and navigation handlers. The converter recognises these templates; anything else in a
  script is customer code.
- **Real projects carry mistakes, and the converter must report them, not copy them:**
  - an import layout that repeats Title and Description;
  - a dashboard card shown twice;
  - generated labels such as "Hfs Fields Hfs S Object Id";
  - a toolbar button with no operation to run;
  - a viewer element that writes `role="widget"` twice.
- **Studio's `.metadata` cannot be trusted for layouts.** It holds Modeler's JSF layouts (Title
  and Description only), while the Web UI files carry the real fields. Its page provider models do
  match the server contributions, so they can cross-check those.
- **`studio-registries.json` is the project's own model, not Studio's catalogue.** It lists the
  project's types, schemas, page providers, images and translations. The slots a contribution can
  target come from Web UI itself, which declares 23 in version 2025.21, and the elements from the
  packages that use them.
- **This sample has no conditions.** No filter, no `dom-if`, no JavaScript expression. The harness
  needs samples that do (section 7).

## 3. What each part becomes

"Automatic" means the converter does it alone and the harness checks it. "Agent proposes" means
an agent suggests the target with its reason, and a person accepts it. "Reported" means it does
not migrate, and the report says why and what to do instead.

| In Studio Designer                                                                                                                                | In the new app                                                                                           | How            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------- |
| Types, schemas, lifecycles, page providers, workflows, chains                                                                                     | Nothing to convert: they stay on the server in the Studio package, and the new app reads them            | —              |
| Document layouts in 5 modes                                                                                                                       | Layout files: version 2 for `view`, version 1 for the rest; `import` has none                            | Automatic      |
| A field bound to `document.properties.<prefix>:<field>`                                                                                           | A field with the matching widget (table below)                                                           | Automatic      |
| `required`, labels, names                                                                                                                         | Field rules; labels as keys in `labels/<locale>.json`                                                    | Automatic      |
| Machine-generated labels ("Hfs Fields Hfs S Object Id")                                                                                           | A tidy label, kept as a translation                                                                      | Agent proposes |
| Repeated fields, repeated dashboard cards                                                                                                         | Kept once                                                                                                | Reported       |
| Search form and results: predicates, columns, sorts, views                                                                                        | A search form and a list over the same page provider, with typed columns, sorts and a table or grid view | Automatic      |
| Slot contributions in mapped slots (`DOCUMENT_ACTIONS`, selection actions, tabs, drawer items and pages)                                          | Entries in the matching slot (`toolbar`, `bulk-actions`, `tabs`, `navbar` and its `sidebar`)             | Automatic      |
| Application pages (`PAGES`)                                                                                                                       | Routes, once what each page shows is mapped                                                              | Agent proposes |
| Contributions in slots the app lacks (user menu, administration, create popup, collection, blob and upload actions, trash, publishing, analytics) | A runtime slot first, decided per slot by demand (parity plan 10.2)                                      | Reported       |
| `nuxeo-operation-button` with an operation and parameters                                                                                         | An action bound to the same operation, if it is on the allow-list                                        | Automatic      |
| A button with no operation, or one not on the allow-list                                                                                          | Nothing until someone decides                                                                            | Reported       |
| Structured conditions: type, facet, permission, group, lifecycle state, path                                                                      | Rules from the registered list                                                                           | Automatic      |
| Free JavaScript conditions that match a known pattern (`user.isMember(…)`, `user.hasPermission(doc, …)`, `document.facets.indexOf(…)`)            | The equivalent structured rule, proven with truth tables (section 6)                                     | Agent proposes |
| Any other free JavaScript condition                                                                                                               | Nothing                                                                                                  | Reported       |
| Tabs whose page is a layout block                                                                                                                 | Tabs of each type's record page                                                                          | Automatic      |
| Tabs whose page is a listing                                                                                                                      | A card of related records over the page provider; not written yet (section 10)                           | Reported       |
| Dashboard (`nuxeo-home`) cards: a page provider, tasks, recently viewed                                                                           | Home cards                                                                                               | Automatic      |
| Theme: `--nuxeo-*` custom properties and a logo                                                                                                   | Theme tokens and a logo (Layer 0), through a token map                                                   | Automatic      |
| Theme properties with no token                                                                                                                    | Nothing: no custom CSS (parity decision 5)                                                               | Reported       |
| Translations, including added languages                                                                                                           | `labels/<locale>.json`                                                                                   | Automatic      |
| Login branding: images, logo, colours                                                                                                             | Sign-in branding in the bootstrap configuration                                                          | Automatic      |
| Workflow task layouts                                                                                                                             | Task forms per workflow step                                                                             | Automatic      |
| Reusable layout blocks                                                                                                                            | A card wherever a layout uses one: version 2 has no reusable block                                       | Automatic      |
| Custom elements of the custom bundle                                                                                                              | A Layer 2 Angular plugin each (section 4)                                                                | Agent proposes |
| Other code in the custom bundle, and customer code in a file Studio generates                                                                     | Nothing: a plugin, if a person writes one                                                                | Reported       |
| HTML blocks with inline scripts, uploaded CSS                                                                                                     | Nothing (parity decisions 2 and 5)                                                                       | Reported       |
| Features of the JSF UI                                                                                                                            | Out of scope: Studio is retiring them                                                                    | —              |

Every slot, and where a contribution to it goes, is in
[`tools/studio-migration/catalogue/slots.json`](../../tools/studio-migration/catalogue/slots.json).
The toolbar of a list of results (`RESULTS_ACTIONS`) is among the slots the app lacks: it is not a
menu on each row, so it does not go to `rowActions`.

**Widgets**, from the elements seen in the sample and in Studio's catalogue. Every element and what
it becomes is in
[`tools/studio-migration/catalogue/elements.json`](../../tools/studio-migration/catalogue/elements.json),
which grows with each package that arrives.

| Web UI element                        | Widget                                 |
| ------------------------------------- | -------------------------------------- |
| `nuxeo-input` (`type="text"`)         | Text, or Number for numeric types      |
| `nuxeo-textarea`                      | Long text                              |
| `nuxeo-date-picker`                   | Date                                   |
| `nuxeo-date` (`format="relative"`)    | Relative date                          |
| `nuxeo-user-suggestion`               | User or group, single or multiple      |
| `nuxeo-user-tag`                      | User                                   |
| `nuxeo-directory-suggestion`          | Vocabulary (its `directory-name`)      |
| `nuxeo-document-suggestion`           | Document link                          |
| `nuxeo-tag`                           | Chips                                  |
| `nuxeo-document-viewer`               | The preview card of a file record      |
| A `<label>` and a bound value         | Read-only field                        |
| `nuxeo-data-table` on a complex field | Table of the field, or related records |

## 4. Two tracks

**The declarative track** turns layouts, search screens, slots, conditions, the dashboard, the
theme and translations into a configuration package. It is a parser and a mapping table, so the
same input always gives the same package. Agents step in only for the "Agent proposes" rows.

**The code track** turns custom elements into Layer 2 Angular plugins. An agent reads the
element (its template, properties, behaviours and events) and writes a standalone component that
follows this repository's conventions (`inject()`, signals, `takeUntilDestroyed()`,
`templateUrl`), with tests written from the element's observed behaviour. Until plugins load at
run time (the plan's decision 5), a plugin is built into the customer's app from the template.
Every plugin is reviewed by a person and passes the repository's gates like any other library.

## 5. The agents

| Agent        | Does                                                                                                                                                           | Never                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Inventory    | Unpacks the package into an empty folder, lists every file and construct, recognises Studio's generated code, records Studio's branch and commit, flags quirks | Runs anything from the package |
| Mapping      | Runs the deterministic converter, then proposes a target for each leftover, with its reason and its confidence                                                 | Accepts its own proposals      |
| Code         | Writes a Layer 2 plugin and its tests for each custom element                                                                                                  | Puts code into configuration   |
| Verification | Runs the harness, sorts the differences into real problems and expected ones, and writes the report                                                            | Marks its own report approved  |

They work through the Builder's MCP server (read the model, validate a package, preview it in
dev mode), plus three migration tools: inventory a package, run the harness, compare two
renderings. They never write to the customer's server: a migrated package reaches it only
through the package pipeline, after a person approves the report.

## 6. The verification harness

A conversion counts only when the harness passes. Every check runs automatically, and every check
has been seen failing on purpose (section 7) before it is trusted.

| #   | Check                    | Proves                                                                                                                | How                                                                                                                                                                                                                                                         |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Nothing dropped          | Every file and construct in the package is converted, proposed, reported, or recognised as Studio's generated code    | The report must be of the package given, and two independent counts of the package's constructs must agree with it: 100%, or the run fails                                                                                                                  |
| 2   | Fields                   | Each converted layout shows the same fields, in the same modes, with the same required flags and the expected widgets | Compares the fields bound in each Polymer layout with those of the converted layout, less the reported duplicates                                                                                                                                           |
| 3   | Model                    | Every converted field, vocabulary and page provider exists on the server                                              | Checks the package against `/config/types`, `/config/schemas`, the directories and the page provider definitions                                                                                                                                            |
| 4   | Labels                   | Every label survives, in every language the package had                                                               | Compares the translation keys and texts, language by language                                                                                                                                                                                               |
| 5   | Conditions               | Each converted rule decides as the original condition did                                                             | A truth table per condition: test users in and out of each group, documents of each type, facet, state and permission. The original is evaluated where it already runs, in Web UI on the migration server, so nothing from the package runs on our machines |
| 6   | What people see          | Both UIs show the same values on the same records                                                                     | Opens a sample of documents per type and mode in Web UI and in the new app as the same user, reads each label and value, normalises dates, users and vocabulary labels, and compares. Screenshots side by side go to the reviewer                           |
| 7   | What the server is asked | Buttons and searches do the same thing                                                                                | Records the requests both UIs send: the operation and its parameters, the page provider and its parameters. They must match, and so must the result counts, once search has caught up with recent writes                                                    |
| 8   | Theme                    | The converted theme keeps the brand and stays readable                                                                | Every property is mapped to a token or reported; contrast is checked against WCAG 2.1 AA; screenshots for the reviewer                                                                                                                                      |
| 9   | Plugins                  | A plugin behaves like the custom element it replaces                                                                  | Its tests pass, it shows the same values on the same records (check 6), it passes lint, test, build and typecheck, and a scan finds no unsafe patterns such as data written as HTML                                                                         |
| 10  | Package                  | The migrated package is valid                                                                                         | The package pipeline's checks: schemas, registered IDs, the operation allow-list, the platform range                                                                                                                                                        |

A migrated package is ready when checks 1 to 10 pass, a person has accepted or rejected every
"Agent proposes" item, and every "Reported" item has an owner and a decision.

**In phase M1** ([`tools/studio-migration`](../../tools/studio-migration/README.md)):

- **What runs in full, with no server:** checks 1, 2, 4, 8 and 10.
- **What runs in part:** checks 3, 5, 6 and 7. Each runs what the package and the conversion
  hold, and says what waits for the migration server: a check that ran in part is `partial`,
  never a pass, and blocks readiness.
  - **3:** the package's own model, from its contributions and XSDs. The platform's model is
    listed.
  - **5:** no invented rule, and nothing shown to everyone that Web UI shows under a condition.
  - **6:** the labels.
  - **7:** the page providers, parameters, sorts and operations each app is configured to ask for.
- **What waited:** check 9, for M3's plugins, which runs since (below).
- **Check 10 and version 1.** It is the package pipeline's validator, plus version 1's contract
  for the `metadata`, `edit` and `create` files, which that validator leaves unchecked.

**In phase M2**, checks 1, 2, 3, 5, 6 and 10 cover task forms, tabs and layout blocks:

- **1:** each task layout and its fields, each layout block, and each use of a block with the
  block's fields there, counted twice.
- **2:** the fields of each block a layout uses, of each tab, and of each task form.
- **3:** a task form's variables against its step's and its workflow's variables schemas.
- **5:** the rule of each tab, of each block's card and of each task form's field, and nothing of
  theirs shown to everyone.
- **6:** the labels of tabs, task forms and blocks.
- **10:** the task forms, through the validator's own rules for them.

**In phase M3**, check 9 holds each custom element's plugin to the element
([`tools/studio-migration`](../../tools/studio-migration/README.md), **The code track**):

- **What needs only the files:** the report lists the element as its plugin; the plugin is the
  element's, from its definition as the package holds it now, with its interface, built into the
  template app, with the template's build and test configuration and a test of every behaviour the
  inventory read; a scan finds no unsafe pattern in it (data written as HTML, the sanitiser
  bypassed, text run as code, a Nuxeo URL bound to `[src]`, the network reached past the app's
  services, a third-party type in its public API, and more) and no code in configuration.
- **What needs the plugin run,** `check --run-plugins`: its own tests pass, with none left to write;
  it passes lint, test, build and typecheck through Nx.
- **What needs the observed behaviour,** `--observed`: it shows the same values as the element on
  the same records, as check 6 compares them, asks the server what the element asked and emits
  what it fired, as it is drawn and as each button is pressed, and shows no button the element's
  behaviour does not press. Read from a file of records and what the element showed, with no
  server: lab mode does not record one from Web UI yet. Whenever the plugin runs, it registers its
  component alone.
- **A plugin not written, or not run,** leaves the check `partial`. A plugin that passes stays a
  proposal until a person accepts it.

**Lab mode**, the first slice against a real server (`lab`, in the
[tool's README](../../tools/studio-migration/README.md), **Lab mode**): it opens documents in Web
UI and in the new app in Chromium, as the same user, refusing anything that may write, records the
requests each sends, and holds them to **the request-log rule**, check 7's server half on a
document's page:

1. **The document:** the new app asks for it, as Web UI does, and is answered as Web UI is.
2. **Its schemas:** every schema Web UI asks for it with, the new app asks for too.
3. **Its properties: every property Web UI fetches and shows, the new app fetches and can show.**
   Web UI shows what a document layout it loaded names in a place outside every condition; the new
   app can show what its page holds a field of, what a `view` or `metadata` layout file it loaded
   lists, and what its page draws itself.

A document lab mode could not compare in full, as the user, with both pages settled and all each
showed read, is never a pass.

The enrichers, page providers and other requests are listed side by side, and held to nothing yet.
Given a package and its conversion, lab mode also runs check 3's server half whole, on the server's
model, and says whether checks 5, 6 and 7 can run there: 6 and 7 stand on the documents only
when Web UI serves the package's own files and the new app its conversion, which needs the package
installed; 5 also needs test users, which lab mode, writing nothing, never creates.

**In phase M0**:

- **What runs:** the harness runs checks 1, 4 and 8, which need no server. Each other check says
  it did not run, why, and which phase brings it. None of them passes for not having run.
- **Pending:** until M1 converts layouts, screens, slots and the dashboard, the report lists them
  as _pending_, with the phase that converts them. Check 1 counts pending as accounted for,
  because nothing is dropped silently. A package with anything pending is not ready.
- **Check 1's two counts:**
  - the parser behind the inventory;
  - patterns over the raw text, sharing no code with that parser.

  On the sample they first disagreed on a viewer element that writes `role="widget"` twice. The
  parser keeps one attribute. A field is an element, so the second count now counts tags marked
  as widgets.

## 7. Test corpus and negative controls

**The corpus:**

- the sample package, for layouts, search screens, slots, the dashboard, the theme and translations;
- synthetic packages, built to cover what the sample lacks: every kind of structured condition,
  known and unknown JavaScript expressions, custom elements, task layouts, tabs, layout blocks,
  and several languages;
- customer packages as they arrive, kept outside this public repository unless their owners agree.

**Negative controls.** Each mutation must make the harness fail; the harness's own tests apply
all of them on every change:

- drop a field from a converted layout, or turn a date widget into text;
- invert a rule, or widen it to every user;
- bind a button to a different operation, or change one parameter;
- drop one translation from one language;
- slip a free JavaScript condition into the converted configuration;
- map the theme's primary colour to the wrong token.

**In M1**, the controls for checks 2, 3, 5, 6, 7 and 10 join them in the same file:

- **For check 2:** drop a field, turn a date widget into text, make a required field optional.
- **For check 3:** name a field the package's own schema lacks.
- **For check 5:** slip a free JavaScript condition in, or show a field or a list column Web UI
  shows only under a condition to everyone. M2 adds inverting a converted rule (`invert-rule`)
  and dropping one (`drop-rule`).
- **For check 6:** change a field's label.
- **For check 7:** point a list at another page provider, change one parameter, bind a button to
  another operation, point a home card at another queue, or drop a menu entry.
- **For check 10:** name a widget the platform does not have.

**In M2**, nine more, for task forms, tabs and layout blocks: drop a task form's field (2), name a
variable its step and workflow lack (3), put a task's variable in a document's layout (10), drop a
block's card or a tab (2), make a field Web UI only shows editable in a task form (2), drop a
tab's rule (5), change a tab's label (6), and drop a block's use from the report (1).

**For Web UI's slot registration** (`nuxeo-slots.js`: `disabled`, `priority`, and a later
contribution of the same name replacing or changing an earlier one), which actions, the menu and
tabs follow, five more: make an action of a disabled button, keep a replaced or an outranked
button rather than the one Web UI keeps, or a menu entry of a disabled one (7), and move an action
from the order Web UI's slot gives it (6).

Each fails its check on the made-up test package. On the sample's conversion, each that finds
something to break fails its check too. The thirteen that do not say so: `widen-to-everyone`,
`widen-column-to-everyone`, `invert-rule`, `drop-rule` and `bind-other-operation` find no
condition and no operation button to break there, and eight of M2's nine no task layout, tab or
layout block.

**In M3**, twenty-four more, for check 9, on the made-up corpus's two custom elements and their
plugins: a plugin that writes data as HTML, drops a value, fails its own tests, leaves one to
write, skips them, holds one that asserts nothing, bypasses the app's HTTP service or its
sanitiser, runs another operation, sends a request as it is drawn, emits another detail, shows a
button its element does not have, registers more than its component, runs `eval`, binds a file
to `[src]`, puts a third-party type in its public API, drops an output, changes its own test
configuration or its project's targets, is not built into the template, puts code into its
`studio-plugin.json`, or was written from another definition of its element; a conversion that
puts an element's code into configuration, or leaves an element out of its report. Each fails
check 9; the ten that only running a plugin shows run, each from a copy of the plugin with the
control applied.

**For the report's decisions** (section 8), six more, which break a `decisions.json` filled in
against its report: take a decided item's owner off, or its decision; change the reason the report
gives for it, as a conversion made again would, with its decisions copied beside it; decide an
item the report does not list, one it
converts, or one item twice. No check fails then: readiness must name each among what stands in
its way, and does, on the made-up package with and without M2's corpus. One more, for check 1,
makes the report one of another version of the package, which check 1 fails.

**In M0**, the controls for the checks that run are mutations in
[`tools/studio-migration/src/mutations.ts`](../../tools/studio-migration/src/mutations.ts):

- **For check 4:** drop a translation, or change its words.
- **For check 8:** map the primary colour to the wrong token, invent a token, or leave out or
  change one of a theme's files.
- **For check 1:** drop a construct from the report, invent one, or report one without a reason.

The tests apply every one, and the `mutate` command applies one to a copy of a conversion for
the phase 0 demo. The controls for the other checks arrive with those checks.

## 8. The report

One per package, written by the verification agent and approved by a person:

- **Header:** the package and its version, Studio's branch and commit and build time, the target
  platform, and the converter's version.
- **Summary:** counts per kind of construct, split into automatic, proposed (accepted, rejected,
  pending), reported, and Studio's generated code; coverage, which must be 100%.
- **Per file:** what it became, what the harness found, and links to the screenshots.
- **Decisions needed:** every reported item, with its owner.

For the sample, M1's report lists:

- 8 of the 10 document layouts, converted: the two import layouts are reported, because the app
  has no import form. SampleTestDocu's view, which only shows the file's preview, becomes no file:
  the app's document page shows the preview;
- the search screen's results, converted to a queue, with its table view, three columns and the
  sort it opens with; its form, its three fields and its two grid views, reported, because a queue
  has neither;
- 4 slot contributions:
  - the button with no operation, reported;
  - the menu entry, converted to an entry of `navigation.json` that opens the search screen's queue,
    and its page, converted to that queue;
  - the theme, converted;
- the dashboard's 5 cards:
  - the repeated one, reported;
  - the favourites card, which reads an operation, proposed;
  - the first card, converted to a card of `home.json` that opens its list, written as a queue. The
    app does not draw a card that is only a link to a queue until phase 1's queue page exists;
  - the tasks and recently viewed cards, pending: `home.json` has no card for either yet;
- the theme's 105 properties against the token map, 8 of them set a token in its first version;
- the theme's blue and its error red, below WCAG 2.1 AA on its own page background, at contrasts
  of 4.43 and 4.17;
- 13 translations;
- the model files, which need no conversion.

The report's data is `report.json`, in the provisional format `studio-migration-report/m1` since
M1. It takes Studio's branch, commit and build time from the bundle's manifest
(`Studio-Git-Branch-Name`, `Studio-Git-Commit-Hash`, `Studio-Build-Time`). The converter writes
it, the same for the same package every time.

**Owners and decisions** are people's, so they are kept beside it, in the conversion's
`decisions.json` (provisional format `studio-migration-decisions/1`), which no conversion writes:
converting the same package again, once the catalogue has learnt something, loses none of them.
The `decisions` command writes the file, an entry for each reported item for a person to fill in
with its owner and what they decided, and carries those of an earlier file of the same build that
still hold. A file is for one build of the package, its version, Studio's commit and build time,
and its bundle's SHA-256, and is taken only for that package, because a construct's id is its
place in its file and another build can give it to another construct; check 1 holds the report
to the package given too. Each decision copies what
it was made on from the report, the item's label, property, outcome, where it was written, its
reason and its rule; where the report no longer says the same, the decision is not taken, and is
made again. Readiness needs a decision taken for every reported item, and nothing wrong in the
file.

**Printed,** with the `report` command: the header, the summary by kind and outcome with the
coverage, what the harness found, every reported item with its owner and decision, every proposal,
and each file with what it became. Lab mode takes the screenshots, beside its own report (section
6); this report does not take them in yet.

**Not yet:** accepting or rejecting a proposal, which needs the converter to write what a person
accepts; recording a reviewer's approval of the report; what the harness found, per file, since
its findings name the conversion's files; and carrying decisions to a new build of the package,
which needs constructs known by more than their place.

Evidence (screenshots, request logs, truth tables) is kept outside the repository, like the Beta's
phase evidence. The summary goes into the pull request that adds the migrated package.

## 9. Where it runs

- **A migration workspace:** a development server with the customer's Studio package installed and
  Web UI running, the new app installed beside it on the same server, fictional test users and
  groups for the truth tables, and sample documents. The documents are fictional, or the
  customer's test data with their written approval.
- **The agents** run at design time, in the coding tools with the MCP server, never against
  production.

## 10. Phases of the migration work

These sit inside the [development plan](development-plan.md):

| Phase | When (development plan) | Delivers                                                                                                                                                                           |
| ----- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0    | Phase 0                 | The catalogue: the slots Web UI declares and the elements of the sample and at least two real packages, the first theme token map; the harness skeleton with its negative controls |
| M1    | Phase 4                 | The declarative track for layouts, search screens, slots, the dashboard, the theme and translations, with harness checks 1 to 8 and 10. The first migrated package is demoed       |
| M2    | Phase 4                 | Conditions (structured, and the known JavaScript patterns) with truth tables; task forms, tabs and layout blocks                                                                   |
| M3    | Phase 6                 | The code track: custom elements to plugins, built into the customer's app from the template, with check 9 and its controls, the `plugin` command and the Code agent's skill        |
| M4    | Phase 10                | Migration at scale: many packages in one run, a self-service upload that validates a package and returns its report, and a support playbook                                        |

**Where M3 stands, 27 November 2026:**

- **Built, and checked on two made-up custom elements only, with no real package.** The inventory
  describes each custom element of the custom bundle: its properties, the bindings it makes, the
  events it fires, the operations it calls and the Web UI behaviours it uses, read without running
  it. The report proposes each as a Layer 2 plugin at `libs/extensions/<element>`, until a person
  accepts it. `npm run studio-migration -- plugin <package.zip> <element>` scaffolds the plugin from
  the template every customer library comes from, with the element's interface and a spec
  skeleton of the behaviours the inventory read, and the Code agent's skill,
  `.cursor/skills/studio-plugin/SKILL.md`, says how to finish it. Check 9 runs as section 6 says,
  with twenty-four negative controls (section 7), each seen failing. Two independent reviews, one of
  correctness and one asking whether a wrong or unsafe plugin could pass, found gaps; the ones
  closed have controls of their own, and the tool's README lists what stays open. The scan stays a
  tripwire that a person's review completes.
- **Built in from the template.** As decision 5 keeps it until signed, pinned plugins are proven, a
  plugin is a library the customer's fork of `apps/nuxeo-satori-template` adds with one line. The two
  made-up plugins, `libs/extensions/acme-claim-exposure` and `acme-claim-escalate`, written with the
  command and the skill, are built into the template so that CI builds them. Run by hand on 27
  November 2026 with `--run-plugins` and the corpus's observed behaviour, check 9 passed on both;
  the tests run their tests and values on every change, and CI their lint, test, build and
  typecheck.
- **Not yet:**
  - a custom element of a real package, which phase 6's demo asks for: real elements will hold
    what the made-up ones do not;
  - the observed behaviour read from Web UI on the migration server: the corpus's was worked out by
    hand from each element's code;
  - run-time loading, which waits for decision 5's spike and its owners;
  - a plugin's place in the app, which the conversion does not write: the person who accepts the
    plugin places it with a manifest entry;
  - another language than the package's own in a plugin, and accepting a proposal, which another
    piece of work brings.
- **Not checked:** on a real package, or by a person reviewing a migrated plugin for a customer.

**Where M4 stands, 26 November 2026:**

- **Built:** the first piece of the self-service migration, for a customer running it on their own
  package: `migrate <package.zip> --out <new-directory>` runs the inventory, the conversion, the
  checks that need no server, the report and the decisions scaffold, in that order, as the
  commands run by hand, and writes what each prints into `--out`. It stops at the first step that
  refuses and says what to do, never writes over an earlier run or its decisions, only reads the
  package, and names the checks whose server half still needs the lab server, and why. With
  `--from`, it carries an earlier run's decisions, before the checks, so that they count. A
  [guide](studio-migration-guide.md) is written for the customer.
- **Built:** many packages in one run. `migrate` given several packages, or a folder of them, runs
  each as it runs one, into a folder of its own, isolated, so that one package's failure or finding
  changes nothing for another, and writes a summary of each package's result, its constructs by
  outcome and its report. It exits as the worst of them, runs the same package once, gives two
  files of one name two folders, and with `--from` an earlier run of several carries each
  package's decisions by its build. One package file runs as before, byte for byte.
- **Built:** the [support playbook](studio-migration-support.md), for a support engineer: how to
  read the report and the decisions file, every finding the tool can print with who acts on it,
  escalation, reproducing a customer's run safely, and lab mode. A test fails when the tool gains
  a finding the playbook does not hold.
- **Not yet:** the upload, which validates a package sent to a service and returns its report. A
  customer runs the command on a copy of this repository, which needs `npm ci`, and with it a read
  token for the Hyland packages on GitHub Packages.
- **Not checked:** on a real package, or by a support engineer on a real case. It was run on the
  made-up packages only.

**Where the report stands, 24 November 2026:**

- **Built:** most of section 8's report, for step 5 of phase 4's demo. Every reported item takes
  an owner and a decision in the conversion's `decisions.json`, which readiness holds to the
  report, and `report` prints the header, the summary by kind and outcome with its coverage, the
  harness's verdict, the decisions needed and what each file became. Six negative controls break
  the decisions, one way each, and check 1 now holds the report to the package given, with a
  control of its own.
- **Not yet:** accepting or rejecting a proposal; a reviewer's approval, which no command records;
  what the harness found, file by file, and the screenshots; carrying decisions to a new build of
  the package.
- **Not checked:** on a real package. The sample is not in this repository, and the report was
  run on the made-up package only.

**Where M2 stands, 23 November 2026:**

- **Built: task forms, tabs and layout blocks.** A workflow task layout becomes the task form of
  its step, `tasks/<workflow>.<step>.layout.json`, its fields bound to the task's variables as
  `var:` fields, with the names' case from the package's variables schemas. A layout block becomes
  a card wherever a layout uses it. A tab becomes a tab of the view file of each type its
  conditions name, holding its page's block, with its conditions as its rule. Checks 1, 2, 3, 5, 6
  and 10 hold them, with nine more negative controls. They are read from Web UI's own sources
  (`nuxeo-document-task.js`, `nuxeo-browser.js`, the stock task layouts and tabs) and tested on the
  synthetic corpus: the sample holds none of them.
- **Reported, against section 3's table:** what has no version 2 equivalent, or cannot be told from
  the package. A permission test in a task layout, whose document Web UI's task page fetches
  without its permissions; a task layout whose names' case the package does not give; a tab on
  every type, on a type with no view file, or whose page is not a block; a tab whose page is a
  listing; a block inside a block, or given no document. A field Web UI only shows becomes a
  read-only field of a task form, and is reported in a version 1 form, which cannot say so.
- **Built: conditions.** A `nuxeo-filter`'s structured tests become the registered rules that
  decide exactly as they do, read from both sides' code. A known JavaScript pattern is proposed:
  one call of a filter function in a `dom-if`, which is all a Polymer binding holds, or `this.`
  calls and `document.facets.indexOf(…)` in a filter's `expression`. Anything else is reported.
  The rule travels as the `visibleWhen` of what the condition hides: a view field where it shows
  its property, an action by its button, a menu entry by its icon and its page's search form, and
  a home card and its queue by its list. Check 5 holds every rule to its condition's truth table,
  without a server.
- **Reported, against the table above:** a `path` test, which no registered rule makes, and
  `hasPermission` for a permission no rule holds alone, such as `Write`. A group test whose file
  holds no user is reported too: a document layout and the stock home are given none, so it never
  passes in Web UI. So is `!document.facets.indexOf(…) !== -1`, which is always true, and a
  condition whose truth table would be too large to run.
- **Not yet:**
  - a tab whose page is a listing, which would be a card of related records;
  - version 2 in the `edit` and `create` forms, which the app now draws, so that a field or a block
    under a condition there carries its rule;
  - conditions on version 1 fields, list columns and search tables;
  - the truth tables' server half, which evaluates each original in Web UI on the migration
    server.

**Where M1 stands, 23 November 2026:**

- **Built:** in [`tools/studio-migration`](../../tools/studio-migration/README.md), the
  declarative track:
  - layouts, search screens as queues, the dashboard's lists as queues and cards of
    `home.json`, the left menu's search entries as entries of `navigation.json`, operation buttons
    as actions, the theme and the translations, written as an app definition the package
    pipeline's validator accepts;
  - checks 2, 3, 5, 6, 7 and 10. Checks 3, 5, 6 and 7 run in part until the migration server
    exists. With M0's, there are twenty-three negative controls.
- **On the sample:**
  - checks 1, 2, 4, 5 and 10 pass;
  - checks 3, 6 and 7 run in part;
  - check 8 finds the two colours below AA.
- **Waiting:**
  - the migration lab server, for the server halves of checks 3, 5, 6 and 7;
  - card kinds of `home.json` for the tasks and recently viewed cards;
  - M2, for conditions, tabs, task forms and layout blocks;
  - real packages: only the sample has arrived, and phase 4 needs three.

**Where M0 stood, 22 November 2026:**

- **Built:** in [`tools/studio-migration`](../../tools/studio-migration/README.md):
  - the package reader and the inventory. On the sample, the reader finds all 40 files and the
    mistakes section 2 lists.
  - the first catalogue, with the fingerprints of Studio's script templates.
  - the M0 conversion: translations, theme tokens and theme files.
  - the harness skeleton, running checks 1, 4 and 8, with nine negative controls.
- **The phase 0 demo runs:** on the sample, checks 1 and 4 pass. Check 8 finds the two colours
  below AA. A deliberately broken copy fails, and says what broke.
- **Next:** owners for reported items, and M1's conversion, since built.
- **Waiting:** only one real package has arrived, and the catalogue needs at least two more.

## 11. Limits

- No free JavaScript, HTML or CSS migrates as such.
- A contribution to a slot the app lacks waits for that runtime slot.
- Behaviour that depends on Web UI's own internals, such as an override of a Web UI element, is
  reported; it may need a plugin or a change to the platform.
- The data model is not changed: it stays in the customer's Studio project.

## 12. Not checked

- A package with conditions, custom elements, task layouts, tabs, layout blocks or several
  languages: the sample has none of them. M2 reads Web UI's own sources for them, and tests them
  on the synthetic corpus only. M3's custom elements, their plugins and check 9 are checked on two
  made-up elements only, whose observed behaviour was worked out by hand.
- Web UI and the new app side by side on one LTS 2025 server with the sample installed: neither
  local server has it.
- Studio's Git access to the generated UI files, on a real project.
- The token map from `--nuxeo-*` properties to Satori's tokens.
