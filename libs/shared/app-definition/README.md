# App definition

The app definition's contract: what a configuration package's files may say. It is plain
TypeScript, with no Angular, so the same code serves:

- the package pipeline, in Node;
- the app when it loads a package, in the browser;
- the designer and the agent;
- the Studio migration, which writes these files.

Phase 0 of the business apps [development plan](../../../docs/business-apps/development-plan.md)
builds it. Two proposals define the files:

- [layout-v2.md](../../../docs/business-apps/layout-v2.md), for layout files;
- [app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md), for the others.

```bash
npm run app-definition:validate -- <package or file>... [--mode view|metadata|edit|create] [--allow-list <file>] [--registered <file>] [--platform <version>] [--model <file>]
```

It is the check behind phase 0's demo step 1, which the package pipeline runs
([package-pipeline.md](../../../docs/business-apps/package-pipeline.md)): a layout naming a widget
the platform does not have is refused, and the message names the file, the place and the widget.
It needs Node 24 and nothing else: `src/bin.mjs` runs the library's TypeScript as it is, with no
install and no transpiler, through `src/typescript-hook.mjs`, which the pipeline's upgrade check
(`scripts/app-upgrade-check.mjs`) imports too, to read the version rules and the registries.

- **Files it checks:**
  - **A directory:** every file of an app definition under it, each known by its place
    (app-definition-v2.md, section 1).
  - **A file:** that file. One whose place says nothing is refused, unless `--mode` names it a
    layout.
- **Inside a package**, a directory with an `app.json`:
  - a JSON file out of place, such as `queue/open.json`, is refused rather than passed over;
  - `demo/` and `assets/` are not checked;
  - version 1's `bootstrap.json`, `manifest.json` and `layouts.json` are left alone.
- **With its package:** each file is checked with its package's `app.json`, `actions.json`,
  `assets/` and `queues/`, whether or not they were named. One of them that cannot be read is
  reported, and fails the run.
- **What the deployment gives it:**
  - **`--allow-list`:** the operations it allows, `{ "operations": [...] }`. Without one, every
    operation is refused. Decision 3 settles where the real allow-list lives.
  - **`--registered`:** what it registers in code beyond the platform's own, as
    `{ "rules", "rowActions", "bulkActions", "actions", "modules", "pages" }`, each a list of ids. A
    customer's Layer 2 rules and actions go here: `actions` are those in any other slot, a
    toolbar's for one, which a package's own action may not take the id of. Domain modules go here
    too, until each is built. So do the connectors its server registers, as
    `"connectors": { "<id>": ["<field>", ...] }`: given them, a card from another system is held to
    its connector's allow-list, and one naming a connector or a field they lack is refused; without
    them, its connector and fields are held to the form of a name only (layout-v2.md, section 7).
  - **`--platform`:** its platform version, which `app.json`'s range must hold.
  - **`--model`:** its server's content model, `{ doctypes, facets, schemas }`, as
    `npm run app-package:model` exports it
    ([package-pipeline.md](../../../docs/business-apps/package-pipeline.md), section 4). Each
    layout is then held to the document type its path names: a field whose property is on neither
    the type nor a facet it declares, a widget that does not show its property's type, and a table
    column or an address part naming a subfield the property lacks are each found. A model it
    cannot read exits 2, with every problem. Version 1 layouts are not held to it, and the run says
    how many layouts were, or that none was.
- **`model <file>`:** reads a content model alone, as `--model` does: exit 0 when it can be read
  whole, 1 with every problem when it cannot. The export checks the file it writes with it.
- **`changes <previous package> <package>`:** compares two versions of one configuration package,
  each a folder holding `bundle/` and `package/`, by the rules of
  [package-pipeline.md](../../../docs/business-apps/package-pipeline.md), section 8
  (`src/lib/changes.ts`), and prints as JSON every change, the version part they need raised, the
  part that was, why the version is refused if it is, and the changelog: exit 0 when the version
  moved far enough, 1 when not, 2 for a folder that is no package or holds a link. The package
  pipeline runs it at step 3, given `--previous`.
- **Version 1 layouts** are left to the version 1 reader in `libs/shared/document-layouts`, and
  counted.
- **Exit codes:**
  - 0: no file has a finding;
  - 1: a file has a finding or cannot be read, or there was nothing to check;
  - 2: the command was wrong.

## What is in it

| File                                  | Validator                | JSON Schema              |
| ------------------------------------- | ------------------------ | ------------------------ |
| `layouts/<Type>/<mode>.layout.json`   | `validateLayoutV2`       | `layout-v2.schema.json`  |
| `tasks/<workflow>.<step>.layout.json` | `validateTaskForm`       | `layout-v2.schema.json`  |
| `app.json`                            | `validateApp`            | `app.schema.json`        |
| `queues/<id>.json`                    | `validateQueue`          | `queue.schema.json`      |
| `actions.json`                        | `validateActions`        | `actions.schema.json`    |
| `labels/<locale>.json`                | `validateLabels`         | `labels.schema.json`     |
| `modules/<module>.json`               | `validateModuleSettings` | `module.schema.json`     |
| `navigation.json`                     | `validateNavigation`     | `navigation.schema.json` |
| `home.json`                           | `validateHome`           | `home.schema.json`       |

- **Each validator returns every finding**, with its place and kind, and leaves the verdict to the
  caller. Layout version 2's section 8 wants two:
  - **`publishable`:** no finding at all. This is the pipeline's verdict.
  - **`loadable`:** no `structure` finding. This is the app's verdict, from phase 1: it is to
    leave out the card or field that an `unknown` or `parameter` finding names, so that a file
    written for a later platform still shows what this one knows. `app.json` and module settings
    are stricter (app-definition-v2.md, section 12).
- **`placeFile` and `validateFile`** place a path in its package, then check the file with the
  rest of its package:
  - a queue may use the package's own actions;
  - a module's settings need `app.json` to turn the module on;
  - a branding image must be in `assets/`;
  - a queue the menu or the home names must be in `queues/`, when the caller knows the package's
    queues. The app reads `home.json` alone, so it does not know them, and does not check them.
- **The registries** hold everything a file may name, by ID (decision 4: no expression language):
  - 21 widgets, each with its parameters, which are checked, and the property types it takes,
    which are checked when a content model is given;
  - the 6 computations and the 2 checks, with their signatures;
  - the rules, row actions and bulk actions the platform registers, version 2's five rules
    among them;
  - the domain modules, of which there are none yet;
  - the pages a menu entry may open, by the ID of the platform's menu entry for each;
  - the connectors to systems of record a server registers, with their fields: none known
    (`null`) until a caller gives them, and `EXTERNAL_WIDGETS`, the 9 widgets a card from another
    system may use;
  - `withRegistered`, which adds a customer's own rules, actions and pages, registered in a
    manifest or in Layer 2 code, modules, and a server's connectors.
- **The JSON Schemas** (draft 2020-12) are for editors, the designer and the agent. Each file may
  name its schema in a `$schema` key. The validators are what refuse a package. They also check
  what a schema expresses poorly:
  - that ids are unique;
  - which keys a mode allows;
  - each widget's parameters and each computation's signature;
  - a task form's `var:` fields;
  - the allow-list;
  - everything across files.
- **`checker.ts`** holds what every file shares: ids, names, rules, values, computations and field
  entries. It reads rules, computations, a customer's rule's parameters and fields `MAX_NESTING`
  (256) levels deep, and finds a `parameter` problem past that rather than overflowing its stack.
- **`content-model.ts`** is the model reader. `readContentModel` reads a server's document types,
  facets and schemas, `{ doctypes, facets, schemas }`, which is `NuxeoContentModel`'s shape: each
  property's type, whether it is a list, its subfields and, when the schema was read with
  `fetch-schema: fields`, its directory. It refuses a model it cannot read
  whole, since a layout held to a model read in part would be refused for what was left out.
  `propertiesOf` gives a type's properties, its facets' included, by `<prefix>:<name>`.
- **`layout-model.ts`** holds a layout to the model, when `validateLayoutV2` is given one and the
  type: each finding is `unknown` or `parameter`, so the app's tolerant loading still applies. A
  checklist's property is held to it too: on the type, a list of complex values, with the four
  subfields `CHECKLIST_SUBFIELDS` names, each of its type. Not
  held to it: a related list's columns, which are other records'; the properties a computation, a
  rule or a widget parameter names; a task form's fields; a vocabulary's `directory` against the
  property's own.
- **`image-source.ts`** holds the rules for a branding image's address. They are version 1's own,
  copied unchanged from `libs/shared/app-config`, which cannot be imported here without Angular.
- **`platform-routes.ts`** is the one list of the platform's own routes, `PLATFORM_ROUTES`, which
  `validateApp` refuses as an app's written address, in the pipeline and in the shell, which then
  leaves the app out of "Switch app". An id that is one, with no address, is said
  by the command line, `addressTakenById`, not refused: the contracts kit was built so, before the
  rule. This library cannot read the application, so `platform-routes.spec.ts` in `apps/nuxeo-ui`
  holds the list to `app.routes.ts`, both ways.

## What holds it to the rest

- **The proposals.** Every JSON example in `layout-v2.md` must validate with no finding. So must
  every example in `app-definition-v2.md`, checked together as one package, in the library and
  through the command.
- **The extension reference.** The rules, row actions, bulk actions and pages must be exactly
  those `docs/extension-reference.md` documents. They live in `libs/shared/extensions`, which needs
  Angular, so they are listed here too, and this test is what keeps the lists one.
- **Version 1's image rules.** The copy in `image-source.ts` must be the same text as
  `describeLogoSrcForm` in `libs/shared/app-config/src/lib/bootstrap-config.ts`, so that a
  correction there fails here until it is copied.
- **The JSON Schemas.** Each must:
  - allow the same keys in each part of a file as its validator;
  - write the validators' patterns;
  - list the same widgets, computations, checks and row actions as the registries.

  The schemas of queues, actions, `app.json`, the menu and the home copy the layout schema's
  definitions they share, so that each stands alone in an editor, and a test keeps the copies equal.

The test target lists both proposals, the extension reference and `bootstrap-config.ts` among its
inputs, so an edit to any of them reruns the tests.

## Tests

```bash
npx nx run-many -t lint,typecheck,test -p shared-app-definition
```

- **Negative controls:** every message a validator can give has one: an input wrong in one way,
  and the exact place, message and kind of what is found. A test reads the validators' source,
  including the messages a widget's parameter check and version 1's image rules give back, and
  fails when a message has no control. It proves that every message has a control, not that every
  guard has one: two guards that give the same message look the same to it. The mutation checks
  are for guards.
- **Mutation checks:** taking out any one of these 145 guards made a test fail. The helper that ran
  them refuses a mutation that does not apply exactly once, and one that breaks a suite instead of
  failing it.
  - **Layouts:**
    - accepting any widget;
    - allowing an id twice;
    - ignoring unknown keys;
    - allowing form keys outside a form;
    - skipping parameter counts;
    - allowing related records outside view mode;
    - writing "1 parameters".
  - **`var:` and task forms:**
    - allowing `var:` outside task forms;
    - letting a task form edit the record's own properties;
    - allowing `var:` in a related list's parameter, a sort, a template's placeholder or a
      widget's parameter.
  - **Queues:**
    - letting a queue take a parameter from a record;
    - skipping its bulk actions, or its rule;
    - a queue with no name.
  - **`app.json`:**
    - skipping the platform range;
    - accepting any module, or a group twice;
    - ignoring its unknown keys;
    - skipping the tab title;
    - letting a branding image climb out with `..`, or hold a backslash;
    - a relative image outside `assets/`;
    - the image rules drifting from version 1's;
    - a written address that is a platform route.
  - **`actions.json`:**
    - ignoring the allow-list;
    - letting it take a platform id, or rebind an id registered in code;
    - letting a bulk action read one record's field;
    - dropping the one-of-two rule;
    - allowing a transition and an operation together;
    - an action with no name;
    - ignoring the file's own keys, or an action's;
    - skipping an action's rule.
  - **Labels and module settings:**
    - accepting any label key, or settings for any module;
    - ignoring the unknown keys of either.
  - **Widget parameters:**
    - rows from 1;
    - no tones;
    - no columns;
    - a list of texts that may be empty, or hold an empty text.
  - **Rules and parameters:**
    - `null` parameters;
    - a rule id that is not one;
    - a `$schema` that is not a text.
  - **The menu and the home:**
    - letting a rule there read a record, in either file, in the checker, or in a customer's own
      rule, which has no signature, at the top of its parameters or in a list;
    - leaving a registered rule nested in a customer's own unchecked;
    - a home schema that lets a card with a figure and a queue go unnamed;
    - no nesting limit, a limit one level short, a level never given back, or fields left unbounded
      (`MAX_NESTING`, 256 levels of rules, computations, a customer's rule's parameters, and
      fields, so tables in tables, in every file);
    - a refused value written out whole in its message, rather than as `{…}` or `[…]`;
    - a bucket with no aggregate;
    - a KPI's parameter from a record;
    - a figure with no name, a page with no name;
    - a card with neither a figure nor a queue, an entry with both a queue and a page;
    - an id twice;
    - skipping a card's rule;
    - accepting any page, or one the reference does not list;
    - `withRegistered` dropping pages;
    - a home key the schema lacks.
  - **Across files:**
    - ignoring the package's own actions in queues;
    - skipping whether `app.json` turns a module on;
    - skipping the branding images;
    - checking a file without its package;
    - ignoring which package has an `app.json`, when a path fits two places;
    - passing any queue the home or the menu names;
    - not placing `home.json`.
  - **The command:**
    - always exiting 0;
    - not reading `assets/`;
    - an allow-list with other keys, or with ids that are not texts;
    - passing over a file out of place;
    - checking `demo/` and `assets/`;
    - passing when a package file cannot be read;
    - a byte-order mark;
    - passing with nothing checked;
    - ignoring `--registered`;
    - knowing queues in a package with no `queues/`.
  - **The content model:**
    - accepting any widget on any property type;
    - accepting a property the type does not have;
    - skipping a table's columns, or an address's parts;
    - leaving a type the model does not have unsaid;
    - dropping a list's directory, from its `itemConstraints`;
    - leaving out the schemas of a facet the type declares;
    - reading `integer` as other than `long`;
    - `validateFile` not passing the model on, or the validator not running its checks;
    - the command exiting 0 for a model it cannot read, with `--model` or with `model <file>`;
    - counting a file that is not a layout as held to the model, or one the validator stops before
      the model's checks: of another version, or with no type, which `heldToModel` answers;
    - reading a prefix that is not a text, or two that disagree, as no prefix;
    - reading an explicit `null` as absent, for a type's facets or schemas, a facet's schemas or a
      schema's fields, or a field's type as `complex`;
    - accepting `""`, `"[]"` or `"string[][]"` as a type;
    - reading a `directoryResolver` that names no directory, or constraints that are not a list, as
      no binding;
    - putting an address part that is not a text into a message, which threw.
  - **Checklists,** 18 more, run on 25 November 2026:
    - a checklist allowed outside view mode, or not a card's content at all;
    - an `ecm:` or `var:` property, or one not written `<prefix>:<name>`, accepted;
    - an empty list of items, an item listed twice, an item with no words, any item id, and a
      checklist that is not an object, accepted;
    - the unknown keys of a checklist, or of an item, ignored;
    - given the model: a property the type lacks, one that is not a list of complex values, a
      subfield missing or of another type accepted; checklists not held to the model at all; and
      `doneOn` read as a text.
  - **Versions:**
    - a caret on `0.x` reaching the next minor version;
    - a prerelease ranked equal to its release;
    - dropping npm's rule that a prerelease is in a range only when a comparator names one.
  - **The contract:**
    - registering a check the schema lacks;
    - listing a rule or a bulk action the reference does not document;
    - a queue key the schema lacks;
    - a copied schema definition drifting;
    - deleting a negative control, or weakening one, in layouts, in the other files and for a
      message given back as a value;
    - adding a refusal with no control, in layouts and in queues.

## Not done yet

- **The rest of the package pipeline:** its first stage is built (package-pipeline.md); phase 3
  completes it.
- **The app's use of it:** a `view` layout draws the record page, in `libs/shared/document-layouts`,
  which loads it with `validateLayoutV2` and `loadable`, and draws its related records, its
  timeline, its comments, another system's fields and its checklists. The other
  modes and queues follow in phase 1, and actions and task forms in phase 2.
- **The content model in the migration server.** The pipeline holds a package to a model when given
  one, and the layout designer, `libs/features/layout-designer`, holds the `view`, `edit` and
  `create` files it edits to the server's; the migration server is still to call `readContentModel`
  and `validateLayoutV2` with it.
- **Rules where there is no one record.** A queue's `visibleWhen`, and a bulk action's, may name a
  rule that reads a record (app-definition-v2.md, section 13). The menu and the home refuse a
  `{ "field" }` value in a rule, and still pass a rule that reads a record.
- **The menu** is joined to the platform's by the app, and **the home** is drawn by
  `libs/shared/home`. Whether an app's menu replaces the platform's is still open.
- **The allow-list's real home and format** (decision 3), and each module's settings schema, which
  comes with the module.
