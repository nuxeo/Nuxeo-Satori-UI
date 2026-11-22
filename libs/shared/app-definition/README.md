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
npm run app-definition:validate -- <package or file>... [--mode view|metadata|edit|create] [--allow-list <file>] [--platform <version>]
```

It is the check behind phase 0's demo step 1, which the package pipeline is to run: a layout
naming a widget the platform does not have is refused, and the message names the file, the place
and the widget.

- **Files it checks:**
  - **A directory:** every file of an app definition under it, each known by its place
    (app-definition-v2.md, section 1).
  - **A file:** that file. One whose place says nothing is refused, unless `--mode` names it a
    layout.
- **With its package:** each file is checked with its package's `app.json`, `actions.json` and
  `assets/`, whether or not they were named.
- **Operations** are refused unless `--allow-list` names a file that lists them,
  `{ "operations": [...] }`. Decision 3 settles where the real allow-list lives.
- **`--platform`** holds `app.json`'s range to a platform version.
- **Version 1 layouts** are left to the version 1 reader in `libs/shared/document-layouts`, and
  counted.
- **Exit codes:**
  - 0: no file has a finding;
  - 1: one has a finding, or a file cannot be read;
  - 2: the command was wrong.

## What is in it

| File                                  | Validator                | JSON Schema             |
| ------------------------------------- | ------------------------ | ----------------------- |
| `layouts/<Type>/<mode>.layout.json`   | `validateLayoutV2`       | `layout-v2.schema.json` |
| `tasks/<workflow>.<step>.layout.json` | `validateTaskForm`       | `layout-v2.schema.json` |
| `app.json`                            | `validateApp`            | `app.schema.json`       |
| `queues/<id>.json`                    | `validateQueue`          | `queue.schema.json`     |
| `actions.json`                        | `validateActions`        | `actions.schema.json`   |
| `labels/<locale>.json`                | `validateLabels`         | `labels.schema.json`    |
| `modules/<module>.json`               | `validateModuleSettings` | `module.schema.json`    |

- **Each validator returns every finding**, with its place and kind, and leaves the verdict to the
  caller. Layout version 2's section 8 wants two:
  - **`publishable`:** no finding at all. This is the pipeline's verdict.
  - **`loadable`:** no `structure` finding. This is the app's verdict, from phase 1: it is to
    leave out the card or field that an `unknown` or `parameter` finding names, so that a file
    written for a later platform still shows what this one knows. `app.json` and module settings
    are stricter (app-definition-v2.md, section 10).
- **`placeFile` and `validateFile`** place a path in its package, then check the file with the
  rest of its package:
  - a queue may use the package's own actions;
  - a module's settings need `app.json` to turn the module on;
  - a branding image must be in `assets/`.
- **The registries** hold everything a file may name, by ID (decision 4: no expression language):
  - 21 widgets, each with its parameters, which are checked, and the property types it takes,
    which are recorded for phase 1 to check;
  - the 6 computations and the 2 checks, with their signatures;
  - the rules, row actions and bulk actions the platform registers today, and the 3 rules version
    2 proposes;
  - the domain modules, of which there are none yet;
  - `withRegistered`, which adds a customer's own rules and actions, registered in Layer 2 code,
    and modules.
- **The JSON Schemas** (draft 2020-12) are for editors, the designer and the agent. The validators
  are what refuse a package. They also check what a schema expresses poorly:
  - that ids are unique;
  - which keys a mode allows;
  - each widget's parameters and each computation's signature;
  - a task form's `var:` fields;
  - the allow-list;
  - everything across files.
- **`checker.ts`** holds what every file shares: ids, names, rules, values, computations and field
  entries.

## What holds it to the rest

- **The proposals.** Every JSON example in `layout-v2.md` must validate with no finding. So must
  every example in `app-definition-v2.md`, checked together as one package.
- **The extension reference.** The rules, row actions and bulk actions must be exactly those
  `docs/extension-reference.md` documents. They live in `libs/shared/extensions`, which needs
  Angular, so they are listed here too, and this test is what keeps the lists one.
- **The proposed rules.** The three new rules must not be documented yet. Once phase 1 implements
  one and documents it, the test fails until it moves into `APP_RULES`.
- **The JSON Schemas.** Each must:
  - allow the same keys in each part of a file as its validator;
  - write the validators' patterns;
  - list the same widgets, computations, checks and row actions as the registries.

  The schemas of queues, actions and `app.json` copy the layout schema's definitions they share,
  so that each stands alone in an editor, and a test keeps the copies equal.

The test target lists both proposals and the extension reference among its inputs, so an edit to
any of them reruns the tests.

## Tests

```bash
npx nx run-many -t lint,typecheck,test -p shared-app-definition
```

- **Negative controls:** every message a validator can give has one: an input wrong in one way,
  and the exact place, message and kind of what is found. A test reads the validators' source and
  fails when a message has no control, so a new refusal cannot arrive without one.
- **Mutation checks:** taking out any one of these 37 guards made a test fail.
  - **Layouts:**
    - accepting any widget;
    - allowing an id twice;
    - ignoring unknown keys;
    - allowing form keys outside a form;
    - skipping parameter counts;
    - allowing related records outside view mode;
    - writing "1 parameters".
  - **The other files:**
    - allowing `var:` outside task forms;
    - letting a task form edit the record's properties;
    - letting a queue take a parameter from a record;
    - skipping a queue's bulk actions;
    - skipping the platform range;
    - accepting any module, or a group twice;
    - letting a branding image climb out of `assets/`;
    - ignoring the allow-list;
    - letting `actions.json` take a platform id;
    - letting a bulk action read one record's field;
    - allowing a transition and an operation together;
    - accepting any label key, or settings for any module.
  - **Across files:**
    - ignoring the package's own actions in queues;
    - skipping whether `app.json` turns a module on;
    - skipping the branding images;
    - checking a file without its package.
  - **Versions:**
    - a caret on `0.x` reaching the next minor version;
    - a prerelease ranked equal to its release.
  - **The contract:**
    - registering a check the schema lacks;
    - listing a rule or a bulk action the reference does not document;
    - a queue key the schema lacks;
    - a copied schema definition drifting;
    - deleting a negative control, in layouts and in the other files;
    - adding a refusal with no control, in layouts and in queues;
    - a command that always exits 0.

## Not done yet

- **The package pipeline:** signing and publishing to pre-production, around this check.
- **The app's use of it:** phase 1 renders layouts and queues, and phase 2 actions and task forms.
- **Checking widgets against property types**, which needs the content model: phase 1's model
  reader.
- **The menu and the home**, whose files phase 1 proposes.
- **The allow-list's real home and format** (decision 3), and each module's settings schema, which
  comes with the module.
