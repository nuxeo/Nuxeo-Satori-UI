# Migrating Web UI customisations from Studio Designer

How a customer's Web UI, configured in Nuxeo Studio Designer as Polymer files, moves to the new
app, with AI agents doing the conversion and a harness proving that nothing was lost.

Written on 21 November 2026 from a sample Studio package (project `Nuxeo-Satori`, LTS 2025), the
[Studio parity plan](../nuxeo-studio-parity-plan.md) and its decisions of 19 November, and the
[architecture](architecture.md). Everything about the sample was read from its files, and nothing
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
| Images             | A login background                                                                                                                                                                                     | `web/nuxeo.war/img/`                       |
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
- **Real projects carry mistakes, and the converter must report them, not copy them:** an import
  layout that repeats Title and Description, a dashboard card shown twice, generated labels such
  as "Hfs Fields Hfs S Object Id", and a toolbar button with no operation to run.
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
| Document layouts in 5 modes                                                                                                                       | Layout version 2, per type and mode                                                                      | Automatic      |
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
| Tabs with a page or a listing                                                                                                                     | Tabs, with a list over the page provider                                                                 | Automatic      |
| Dashboard (`nuxeo-home`) cards: a page provider, tasks, recently viewed                                                                           | Home cards                                                                                               | Automatic      |
| Theme: `--nuxeo-*` custom properties and a logo                                                                                                   | Theme tokens and a logo (Layer 0), through a token map                                                   | Automatic      |
| Theme properties with no token                                                                                                                    | Nothing: no custom CSS (parity decision 5)                                                               | Reported       |
| Translations, including added languages                                                                                                           | `labels/<locale>.json`                                                                                   | Automatic      |
| Login branding: images, logo, colours                                                                                                             | Sign-in branding in the bootstrap configuration                                                          | Automatic      |
| Workflow task layouts                                                                                                                             | Task forms per workflow step                                                                             | Automatic      |
| Reusable layout blocks                                                                                                                            | Reusable blocks in layout version 2                                                                      | Automatic      |
| Custom elements and code in the custom bundle                                                                                                     | A Layer 2 Angular plugin (section 4)                                                                     | Agent proposes |
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
| 1   | Nothing dropped          | Every file and construct in the package is converted, proposed, reported, or recognised as Studio's generated code    | Two independent counts of the package's constructs must agree with the report: 100%, or the run fails                                                                                                                                                       |
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

## 8. The report

One per package, written by the verification agent and approved by a person:

- **Header:** the package and its version, Studio's branch and commit and build time, the target
  platform, and the converter's version.
- **Summary:** counts per kind of construct, split into automatic, proposed (accepted, rejected,
  pending), reported, and Studio's generated code; coverage, which must be 100%.
- **Per file:** what it became, what the harness found, and links to the screenshots.
- **Decisions needed:** every reported item, with its owner.

For the sample, the report would list:

- the 10 document layouts and the search screen, converted;
- 4 slot contributions, of which the button with no operation is reported;
- the dashboard's 5 cards, with the repeated one reported;
- the import layout's second Title and Description, reported;
- the theme's 105 properties against the token map, 8 of them set a token in its first version;
- 13 translations;
- the model files, which need no conversion.

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
| M3    | Phase 6                 | The code track: custom elements to plugins, with check 9                                                                                                                           |
| M4    | Phase 10                | Migration at scale: many packages in one run, a self-service upload that validates a package and returns its report, and a support playbook                                        |

**Where M0 stands, 22 November 2026:**

- **Built:** the package reader, the inventory and the first catalogue, in
  [`tools/studio-migration`](../../tools/studio-migration/README.md). On the sample, the reader
  finds all 40 files and the four mistakes section 2 lists.
- **Next:** the harness skeleton.
- **Waiting:** only one real package has arrived, and the catalogue needs at least two more.

## 11. Limits

- No free JavaScript, HTML or CSS migrates as such.
- A contribution to a slot the app lacks waits for that runtime slot.
- Behaviour that depends on Web UI's own internals, such as an override of a Web UI element, is
  reported; it may need a plugin or a change to the platform.
- The data model is not changed: it stays in the customer's Studio project.

## 12. Not checked

- A package with conditions, custom elements, task layouts, tabs or several languages: the sample
  has none of them.
- Web UI and the new app side by side on one LTS 2025 server with the sample installed: neither
  local server has it.
- Studio's Git access to the generated UI files, on a real project.
- The token map from `--nuxeo-*` properties to Satori's tokens.
