# App definition version 2: the other files

A proposal for the files of an app definition beside its layouts:

- `app.json`;
- queues;
- actions;
- task forms;
- labels;
- module settings.

Phase 0 of the [development plan](development-plan.md) gives each a JSON schema.
[Layout file version 2](layout-v2.md) covers the layouts, and this document reuses its rules. The
validator in [`libs/shared/app-definition`](../../libs/shared/app-definition/README.md) checks
every file, and every JSON example here is one of its tests: together they are one small package,
the Payers Claims app, checked as a whole.

Status: proposal, 22 November 2026. Nothing reads these files yet. Phase 1 renders queues, and
phase 2 the actions and task forms.

## The short version

- **One package per app.** Its `app.json` names the app, the groups it is for, the platform it
  needs and the domain modules it turns on.
- **Every file says `"version": 2`**, and uses layout version 2's ids, rules and values. There is
  no expression language (decision 4).
- **A queue** is a page provider with columns, facets, sorts and actions.
- **An action** is a lifecycle button, or a button that runs an operation. The operation must be
  on the deployment's allow-list (decision 3, still open).
- **A task form** is a layout file for one workflow step. Its `var:` fields are the step's
  variables.
- **Labels** are per language. **Module settings** are per module.
- **Strict when built, tolerant when loaded**, as for layouts, except `app.json`: the shell
  refuses an app it cannot run rather than draw half of it.

## 1. The package

The architecture's file list ([section 10](architecture.md#10-app-definitions-and-their-lifecycle)),
with where each file is described:

```text
app.json                             section 3
navigation.json                      phase 1, with the home
home.json                            phase 1
layouts/<Type>/<mode>.layout.json    layout-v2.md
queues/<id>.json                     section 4
actions.json                         section 5
tasks/<workflow>.<step>.layout.json  section 6
labels/<locale>.json                 section 7
modules/<module>.json                section 8
assets/                              images the files name
demo/                                starter kits only; not checked
```

- **The root** is the directory that holds `app.json`. In a configuration package built as today,
  that is `bundle/agentic-ui-config/`.
- **A file's place says what it is.** A queue's id, a task form's workflow and step, a labels
  file's language and a module's name come from the file name, as a layout's type and mode do.
- **`navigation.json` and `home.json`** are not in phase 0's list. Phase 1 builds the menu and the
  home, and proposes their files with them.

## 2. What every file shares

- **`"version": 2`.** A file with any other version is refused, and nothing else in it is read.
- **Ids**, where a file has them, are layout version 2's: 1 to 64 letters, digits, `.`, `_` or
  `-`, starting with a letter or a digit. Each is used once in its file.
- **Names.** What a person sees has a `label`, a text shown as it is, or a `labelKey`, looked up in
  the labels (section 7), or both. `label` wins, as in version 1.
- **Rules and values** are layout version 2's ([sections 4 and 5](layout-v2.md#4-computations)): a
  rule is a registered id or `{ "type", "parameters" }`, and a value is a literal, a
  `{ "field" }` or a `{ "computed" }`.
- **Keys.** A key a file does not have, such as a misspelt one, is refused when the package is
  built and ignored when the app loads it.
- **Findings** have layout version 2's three kinds: `structure`, `unknown` and `parameter`.
  Section 10 says what each does to each file.

## 3. `app.json`

```json app.json
{
  "version": 2,
  "id": "payers-claims",
  "label": "Claims",
  "labelKey": "payers.app.claims",
  "packageVersion": "1.0.1",
  "platform": ">=0.3.0 <1.0.0",
  "groups": ["claims-adjusters", "claims-supervisors"],
  "modules": ["cases"],
  "branding": {
    "applicationTitle": "Payers Claims",
    "theme": "payers"
  }
}
```

| Key                 | Required    | What it is                                                                                                                               |
| ------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | Yes         | The app's id in the registry: lower-case letters, digits and `-`, starting with a letter. It stays the same from one version to the next |
| `label`, `labelKey` | One of them | The app's name, as "Switch app" lists it                                                                                                 |
| `packageVersion`    | Yes         | The package's semantic version, such as `1.0.1`                                                                                          |
| `platform`          | Yes         | The platform versions it runs on, as a range: `>=0.3.0 <1.0.0`, `^1.2.0` or `~1.2.0`                                                     |
| `address`           | No          | Where the shell opens it, under the shell's own address. The same form as `id`, which it is when left out                                |
| `groups`            | Yes         | The groups it is for. `members` is everyone                                                                                              |
| `modules`           | No          | The domain modules it turns on ([architecture](architecture.md#6-the-modules), section 6)                                                |
| `branding`          | No          | `applicationTitle`, `documentTitle`, `logo` and `favicon`, as version 1's bootstrap writes them, and `theme`: one of the server's themes |

- **The platform range.** The shell refuses an app whose range leaves out its own version, and
  says both. The pipeline checks the range against the version of the server it publishes for.
- **Groups.** Decision E settles whether the registry serves an app definition only to its groups,
  after sign-in. Until then the field is written and checked. Either way it is not a security
  control: Nuxeo's permissions still decide which records a person reads.
- **Modules.** A module the platform does not have is refused: an app that needs it cannot run. No
  domain module exists yet, so this document's examples are checked with one named `cases`
  registered.
- **Branding images.** A `logo` or `favicon` whose `src` is `assets/<file>` must be in the
  package. An `https:` or `data:image/` source is taken as version 1 takes it, and `null` keeps
  the platform's own.

## 4. Queues

```json queues/unassigned-claims.json
{
  "version": 2,
  "label": "Unassigned claims",
  "labelKey": "payers.queue.unassigned",
  "pageProvider": "payers_unassigned_claims",
  "columns": [
    "claim:number",
    { "field": "claim:member", "widget": "document-link" },
    { "field": "claim:billedAmount", "widget": "currency", "parameters": { "currency": "USD" } },
    { "field": "claim:received", "widget": "relative-date" }
  ],
  "sort": [{ "field": "claim:received", "order": "asc" }],
  "pageSize": 50,
  "facets": [{ "aggregate": "claim_type_agg", "label": "Claim type" }],
  "rowActions": ["payers.claim.requestRecords", "app.rowActions.download"],
  "bulkActions": ["payers.claims.assignToMe", "app.bulkActions.downloadZip"],
  "visibleWhen": { "type": "app.rules.inGroup", "parameters": ["claims-adjusters"] }
}
```

- **The id is the file name.** `queues/unassigned-claims.json` is the queue `unassigned-claims`,
  which phase 1's menu and home name.
- **A list of records, as a related-records card has**
  ([layout-v2.md, section 7](layout-v2.md#7-related-records)): `pageProvider`, `parameters`,
  `columns`, `sort`, `pageSize` and `rowActions`. The one difference is that a queue has no open
  record, so its parameters are literals. A page provider for one person's work names the person
  in its own query, on the server.
- **`facets`** are filters from the page provider's aggregates, each named as the page provider
  defines it on the server.
- **`rowActions` and `bulkActions`** are the platform's registered actions
  ([extension-reference.md](../extension-reference.md), sections 10a and 5), or the package's own,
  from `actions.json`, that show on rows or in bulk.
- **`visibleWhen`** decides who sees the queue. Hiding a queue is not a security control: the page
  provider still returns only what the person may read.
- **A queue needs a name:** `label` or `labelKey`.

## 5. Actions

```json actions.json
{
  "version": 2,
  "actions": [
    {
      "id": "payers.claim.approve",
      "label": "Approve",
      "icon": "check",
      "order": 10,
      "visibleWhen": { "type": "app.rules.isType", "parameters": ["Claim"] },
      "transition": "approve",
      "confirm": { "label": "Approve this claim?" },
      "success": { "label": "The claim is approved." }
    },
    {
      "id": "payers.claim.requestRecords",
      "labelKey": "payers.action.requestRecords",
      "icon": "outgoing_mail",
      "on": ["record", "row"],
      "visibleWhen": { "type": "app.rules.inState", "parameters": ["pending"] },
      "operation": "Payers.RequestMedicalRecords",
      "parameters": { "provider": { "field": "claim:provider" }, "urgent": false },
      "success": { "labelKey": "payers.action.requestRecords.sent" },
      "refresh": true
    },
    {
      "id": "payers.claims.assignToMe",
      "label": "Assign to me",
      "on": ["bulk"],
      "operation": "Payers.AssignToCurrentUser",
      "parameters": { "notify": true }
    }
  ]
}
```

| Key                  | What it is                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | Required, and the package's own: an id starting `app.` or `core.` is the platform's, and a manifest cannot rebind those ([extension-reference.md](../extension-reference.md), section 1) |
| `label`, `labelKey`  | The button's text. One of them is required                                                                                                                                               |
| `icon`               | A Material Symbols name, such as `check`                                                                                                                                                 |
| `order`              | A whole number. Lower comes first                                                                                                                                                        |
| `on`                 | Where it shows: `record`, the record page's toolbar; `row`, a queue's row menu; `bulk`, a queue's selection. `["record"]` when left out                                                  |
| `visibleWhen`        | A rule                                                                                                                                                                                   |
| `transition`         | A lifecycle transition. The button shows only when the record's lifecycle allows it, as phase 2's allowed-transitions enricher says                                                      |
| `operation`          | An Automation operation or chain, on the deployment's allow-list                                                                                                                         |
| `parameters`         | The operation's parameters: each name to a value                                                                                                                                         |
| `confirm`, `success` | `{ "label" }` or `{ "labelKey" }`: a question before it runs, and a message after                                                                                                        |
| `refresh`            | Whether the record or the queue reloads afterwards. True when left out                                                                                                                   |

- **One of `transition` and `operation`.** Parameters belong to an operation only.
- **The allow-list.** Decision 3 makes it per deployment, and phase 2's security review signs it
  off. Until then the validator takes it as a file of operation ids, shown below. With none it
  refuses every operation: a package cannot reach a server operation nobody allowed.
- **A bulk action's parameters are literals.** It runs on many records at once, so no one record's
  field can give it a value.
- **The server decides.** Nuxeo's permissions and the lifecycle still gate every operation and
  every transition. Hiding a button is not a security control.

The allow-list the validator reads for now:

```json allow-list.json
{
  "operations": ["Payers.RequestMedicalRecords", "Payers.AssignToCurrentUser"]
}
```

## 6. Task forms

A task form is a layout file for one step of a workflow, `tasks/<workflow>.<step>.layout.json`,
named by the workflow model's id and the step's. It replaces the form generated from the step's
variables, which the server describes in `taskInfo.schemas`, as Web UI's task layouts do.

```json tasks/claimDetermination.determine.layout.json
{
  "version": 2,
  "cards": [
    {
      "id": "claim",
      "label": "Claim",
      "fields": [
        "claim:number",
        {
          "field": "claim:billedAmount",
          "widget": "currency",
          "parameters": { "currency": "USD" }
        }
      ]
    },
    {
      "id": "determination",
      "label": "Determination",
      "fields": [
        {
          "field": "var:decision",
          "widget": "vocabulary",
          "parameters": { "directory": "claimDecision" },
          "required": true
        },
        {
          "field": "var:allowedAmount",
          "widget": "currency",
          "parameters": { "currency": "USD" },
          "required": {
            "type": "app.rules.fieldIn",
            "parameters": [{ "field": "var:decision" }, "approve", "partial"]
          },
          "checks": [
            {
              "type": "core.atMost",
              "parameters": [{ "field": "claim:billedAmount" }],
              "label": "No more than the billed amount"
            }
          ]
        },
        {
          "field": "var:denialReason",
          "widget": "long-text",
          "required": {
            "type": "app.rules.fieldIn",
            "parameters": [{ "field": "var:decision" }, "deny"]
          }
        }
      ]
    }
  ]
}
```

- **It is an edit-mode layout file**, with the same keys and rules: cards or tabs; fields with
  `required`, `readOnlyWhen` and `checks`; no `columns`, `span` or related records.
- **`var:<name>`** names a variable of the step or of its workflow. A task form edits only these,
  and `var:` means nothing in any other file.
- **The record's own properties**, such as `claim:billedAmount`, show read-only. A value may still
  read them, as the check above does.
- **The buttons** are the step's own, from the workflow: approve and deny, here. Whether a field
  can be required for one button only is phase 2's to decide.

## 7. Labels

```json labels/en.json
{
  "version": 2,
  "labels": {
    "payers.app.claims": "Claims",
    "payers.queue.unassigned": "Unassigned claims",
    "payers.action.requestRecords": "Request medical records",
    "payers.action.requestRecords.sent": "Medical records requested",
    "layout.field.claim:memberId": "Member ID"
  }
}
```

- **One file per language**, named by its language tag, as the platform's catalogues are: `en`,
  `fr`, `de`, `ja` and `nl` today, or one with a region, such as `pt-BR`.
- **A key** is the app's own, best begun with the app's name, or the platform's, such as
  `layout.field.claim:memberId`, which this replaces in this language. Version 1's manifest
  `labels` replace a key in every language at once.
- **A text** is not empty.
- **Looking a key up:** in the person's language, in the package first and then in the
  platform's catalogue.

## 8. Module settings

```json modules/cases.json
{
  "version": 2,
  "settings": {
    "checklist": "payers_case_documents"
  }
}
```

- **One file per module** that `app.json` turns on, named by the module. A settings file for a
  module the app does not turn on is refused.
- **`settings`** is an object, and what it holds is the module's to define: the setting above is
  an illustration. Every module brings the schema of its settings when it is built
  ([architecture](architecture.md#6-the-modules), section 6). Until one does, the validator checks
  that the module is registered and that `settings` is an object.

## 9. Checks across files

Each file is checked with its package's `app.json`, `actions.json` and `assets/`:

- a queue's row and bulk actions are the platform's, or defined in `actions.json` with `row` or
  `bulk` in `on`;
- a module's settings are for a module `app.json` turns on;
- a branding image in `assets/` is in the package;
- a file's name says what the file is: a queue's id, a workflow and a step, a language, a module.

## 10. What is refused, and when

When the package is built, every finding refuses it, naming the file, the place and the problem.
When the app loads a file, it is tolerant, except of `app.json`:

| File            | A structural error                                                   | An id this platform does not have                        |
| --------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| `app.json`      | The app is refused, and "Switch app" does not list it                | The app is refused too: it needs what the platform lacks |
| A queue         | The queue is left out                                                | That column, facet or action is left out                 |
| `actions.json`  | That action is left out; all of them, if the error is the file's own | That action is left out                                  |
| A task form     | The step's generated form shows instead                              | That field is left out                                   |
| A labels file   | The file is not applied: the platform's labels show                  | —                                                        |
| Module settings | The app is refused, as for `app.json`                                | The file is ignored                                      |

Settings a module cannot read refuse the app, because the module would run half configured. A
settings file for a module the app does not turn on is ignored.

## 11. Not settled here

- **Decision E:** whether the registry serves each app definition only to its groups, after
  sign-in. `groups` is written and checked now.
- **Decision 3 and the security review of operation buttons**, in phase 2: the allow-list's home,
  format and owner. The file above is the validator's input until then.
- **Addresses by host name**, for tenants (decision G). `address` is a path only.
- **In task forms:** rules for one button only, and starting a workflow from a record with its
  start form.
- **In labels:** placeholders and plural forms, and a check that every key an app uses has a text.
- **Each module's settings schema**, which comes with the module.
- **The menu and the home**, in phase 1.
- **The person signed in as a page provider parameter.** A page provider names them on the server
  for now.
- **Related-records lists** keep the platform's row actions. Whether they also take the package's
  own is phase 1's to decide.
