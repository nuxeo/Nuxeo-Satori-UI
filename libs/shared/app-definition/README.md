# App definition

The app definition's contract: what a configuration package's files may say. It is plain
TypeScript, with no Angular, so the same code serves:

- the package pipeline, in Node;
- the app when it loads a package, in the browser;
- the designer and the agent;
- the Studio migration, which writes these files.

Phase 0 of the business apps [development plan](../../../docs/business-apps/development-plan.md)
starts it with layout file version 2, as proposed in
[docs/business-apps/layout-v2.md](../../../docs/business-apps/layout-v2.md).

```bash
npm run app-definition:validate -- <configuration package or layout file>... [--mode view|metadata|edit|create]
```

It is the check behind phase 0's demo step 1, which the package pipeline is to run: a layout
naming a widget the platform does not have is refused, and the message names the file, the place
and the widget.

- **Files it checks:** every `*.layout.json` under the paths it is given. It reads each file's mode
  from its path, `layouts/<Type>/<mode>.layout.json`, unless `--mode` names it, and refuses a file
  whose mode it cannot tell.
- **Version 1 files** are left to the version 1 reader in `libs/shared/document-layouts`, and
  counted.
- **Exit codes:**
  - 0: every version 2 file has no finding;
  - 1: one has a finding, or a file cannot be read;
  - 2: the command was wrong.

## What is in it

- **`validateLayoutV2(content, { mode, registries })`** returns every finding, with its place and
  kind, and leaves the verdict to the caller. The proposal's section 8 wants two verdicts:
  - **`publishable`:** no finding at all. This is the pipeline's verdict.
  - **`loadable`:** no `structure` finding. This is the app's verdict, from phase 1: it is to
    leave out the card or field that an `unknown` or `parameter` finding names, so that a file
    written for a later platform still shows what this one knows.
- **The registries,** which hold everything a file may name, by ID (decision 4: no expression
  language):
  - 21 widgets, each with its parameters, which are checked, and the property types it takes,
    which are recorded for phase 1 to check;
  - the 6 computations and the 2 checks, with their signatures;
  - the rules and row actions the platform registers today, and the 3 rules version 2 proposes;
  - `withRegistered`, which adds a customer's own rules and row actions, registered in Layer 2 code.
- **[`layout-v2.schema.json`](src/layout-v2.schema.json)**, a JSON Schema (draft 2020-12) for
  editors, the designer and the agent. The validator is what refuses a package. It also checks
  what a schema expresses poorly:
  - that ids are unique;
  - which keys a mode allows;
  - each widget's parameters;
  - each computation's signature.

## What holds it to the rest

- **The proposal.** Every JSON example in `layout-v2.md` must validate with no finding.
- **The extension reference.** The rules and row actions must be exactly those
  `docs/extension-reference.md` documents. They live in `libs/shared/extensions`, which needs
  Angular, so they are listed here too, and this test is what keeps the two lists one.
- **The proposed rules.** The three new rules must not be documented yet. Once phase 1 implements
  one and documents it, the test fails until it moves into `APP_RULES`.
- **The JSON Schema.** It must list the same widgets, computations, checks and row actions as the
  registries, and allow the same keys in each part of a file as the validator.

The test target lists both documents among its inputs, so an edit to either reruns the tests.

## Tests

```bash
npx nx run-many -t lint,typecheck,test -p shared-app-definition
```

- **Negative controls:** every message the validator can give has one: an input wrong in one way,
  and the exact place, message and kind of what is found. A test reads the validator's source and
  fails when a message has no control, so a new refusal cannot arrive without one.
- **Mutation checks:** taking out any one of these guards made a test fail:
  - accepting any widget;
  - allowing an id twice;
  - ignoring unknown keys;
  - allowing form keys outside a form;
  - skipping parameter counts;
  - allowing related records outside view mode;
  - registering a check the schema lacks;
  - listing a rule the reference does not document;
  - a command that always exits 0;
  - deleting one negative control;
  - adding a refusal with no control;
  - writing "1 parameters".

## Not done yet

- **The package pipeline:** signing and publishing to pre-production, around this check.
- **The app's use of it:** phase 1, when the record page renders version 2.
- **Checking widgets against property types**, which needs the content model: phase 1's model
  reader.
- **The other schemas** phase 0 lists for app definition version 2: `app.json`, whose groups depend
  on decision E, queues, actions, task forms, labels and modules.
