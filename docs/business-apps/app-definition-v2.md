# App definition version 2: the other files

A proposal for the files of an app definition beside its layouts:

- `app.json`;
- queues;
- actions;
- task forms;
- labels;
- module settings;
- the menu, `navigation.json`;
- the home, `home.json`.

Phase 0 of the [development plan](development-plan.md) gives each a JSON schema.
[Layout file version 2](layout-v2.md) covers the layouts, and this document reuses its rules. The
validator in [`libs/shared/app-definition`](../../libs/shared/app-definition/README.md) checks
every file, and every JSON example here is one of its tests: together they are one small package,
the Payers Claims app, checked as a whole.

Status: proposal, 22 November 2026; the menu and the home added on 23 November 2026, in phase 1;
the app registry, which serves an app's files on a server after sign-in, on 24 November 2026
(section 10); the deployment layer, a customer's own versions of an app's layouts and queues that
the registry serves over its package's, on 25 November 2026 (section 10). The app draws the home
(section 10), the queues (section 4), the menu (section 9), the labels (section 7) and the task
forms (section 6); since 25 November 2026, the operation buttons of `actions.json` (section 5), on
decision 3's recommendation. Nothing in the app reads
module settings yet.

## The short version

- **One package per app.** Its `app.json` names the app, the groups it is for, the platform it
  needs and the domain modules it turns on.
- **Every file says `"version": 2`**, and uses layout version 2's ids, rules and values. There is
  no expression language (decision 4).
- **A queue** is a page provider with columns, facets, sorts and actions.
- **An action** is a lifecycle button, or a button that runs an operation. The operation must be
  on the deployment's allow-list, which the server holds (decision 3, still open, built on its
  recommendation).
- **A task form** is a layout file for one workflow step. Its `var:` fields are the step's
  variables.
- **Labels** are per language. **Module settings** are per module.
- **The menu** lists queues and pages. **The home** is cards of KPIs and links to queues, each
  with a rule, so that each group has its own.
- **Strict when built, tolerant when loaded**, as for layouts, except `app.json`: the shell
  refuses an app it cannot run rather than draw half of it.

## 1. The package

The architecture's file list ([section 10](architecture.md#10-app-definitions-and-their-lifecycle)),
with where each file is described:

```text
app.json                             section 3
navigation.json                      section 9
home.json                            section 10
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
- **`navigation.json` and `home.json`** were not in phase 0's list. Phase 1 proposes them, with
  the home that draws `home.json`.

## 2. What every file shares

- **`"version": 2`.** A file with any other version is refused, and nothing else in it is read.
- **Ids**, where a file has them, are layout version 2's: 1 to 64 letters, digits, `.`, `_` or
  `-`, starting with a letter or a digit. Each is used once in its file.
- **Names.** What a person sees has a `label`, a text shown as it is, or a `labelKey`, looked up in
  the labels (section 7), or both. `label` wins, as in version 1.
- **Rules and values** are layout version 2's ([sections 4 and 5](layout-v2.md#4-computations)): a
  rule is a registered id or `{ "type", "parameters" }`, and a value is a literal, a
  `{ "field" }` or a `{ "computed" }`.
- **Keys.** A key a file does not have, such as a misspelt one, is an `unknown` finding. It
  refuses the package when it is built, and section 12 says what it does when the app loads the
  file. `$schema`, the address of a JSON Schema for editors, may head any file, as it heads
  version 1's fragments.
- **Findings** have layout version 2's three kinds: `structure`, `unknown` and `parameter`.
  Section 12 says what each does to each file.

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
| `address`           | No          | Where the shell opens it, under the shell's own address. The same form as `id`, which it is when left out, and not a platform route      |
| `groups`            | Yes         | The groups it is for. `members` is everyone                                                                                              |
| `modules`           | No          | The domain modules it turns on ([architecture](architecture.md#6-the-modules), section 6)                                                |
| `branding`          | No          | `applicationTitle`, `documentTitle`, `logo` and `favicon`, as version 1's bootstrap writes them, and `theme`: one of the server's themes |

- **The address is not the platform's.** An address that is the first segment of one of the
  platform's own pages is refused, so that the shell can open the app there: an app with the id
  `contracts` would take `/contracts`, the component showcase, so it needs an `address` of its
  own, such as `contract-desk`. With no `address`, the id is the address, and an id that is one of
  them is said by the pipeline and the command line, not refused yet: the contracts kit was built
  so, before the rule. The `app-package` generator writes every new app's address, and refuses one
  that is a route. The shell refuses an app with a refused address too, as it refuses any finding
  in `app.json` (section 10): "Switch app" does not list it. The platform's routes are listed in one place, `PLATFORM_ROUTES` in
  [`libs/shared/app-definition/src/lib/platform-routes.ts`](../../libs/shared/app-definition/src/lib/platform-routes.ts),
  which a test in `apps/nuxeo-ui` holds to `app.routes.ts` both ways. A queue's id needs no such
  check: a queue opens under `/queues/`.
- **The platform range.** The shell is to refuse an app whose range leaves out its own version,
  and say both; it does not yet, since it does not know its version at run time (section 13).
  The pipeline checks the range against the version of the server it publishes for.
  A range admits what npm's would: `^` and `~` stop short of the next version's prereleases, and
  a prerelease is in a range only when one of its comparators names a prerelease of the same
  version.
- **Groups.** The app registry serves an app definition only to its groups, after sign-in
  (section 10), built against decision E's proposed answer, which is still open. Either way it is
  not a security control: Nuxeo's permissions still decide which records a person reads.
- **Modules.** A module the platform does not have is refused: an app that needs it cannot run. No
  domain module exists yet, so this document's examples are checked with one named `cases`
  registered.
- **Branding images.** A `logo` or `favicon`'s `src` is held to version 1's own rules, unchanged:
  an `https:` address that names a host, a `data:image/` address with a payload, or a relative
  path with no `..`, however it is written. No backslash and no control character is allowed.
  Here a relative path must also be in the package's `assets/`, and the file must be there.
  `null` keeps the platform's own. When the app loads it, version 1 still decides where the
  address may point.

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
  ([layout-v2.md, section 7](layout-v2.md#7-related-records-the-timeline-and-comments)): `pageProvider`, `parameters`,
  `columns`, `sort`, `pageSize` and `rowActions`. The one difference is that a queue has no open
  record, so its parameters are literals. A page provider for one person's work names the person
  in its own query, on the server.
- **`facets`** are filters from the page provider's aggregates, each named as the page provider
  defines it on the server. When the package's own model defines the page provider, the pipeline
  refuses a facet whose aggregate it does not define ([package-pipeline.md](package-pipeline.md),
  section 2). A facet on a reference, an aggregate whose buckets are records' ids, may show each
  bucket by its record's title with `"widget": "document-link"`, as a `document-link` column shows
  one: `{ "aggregate": "dmg_move_agg", "labelKey": "moves.facet.move", "widget": "document-link" }`.
  It is the only widget a facet takes: another is a `parameter` finding, and one nobody registered
  `unknown`.
- **`rowActions` and `bulkActions`** are the platform's registered actions
  ([extension-reference.md](../extension-reference.md), sections 10a and 5), or the package's own,
  from `actions.json`, that show on rows or in bulk.
- **`visibleWhen`** decides who sees the queue. Hiding a queue is not a security control: the page
  provider still returns only what the person may read.
- **A queue needs a name:** `label` or `labelKey`.
- **`search`** makes the queue one a person searches rather than browses: a text field above its
  list, named by the search's `label` or `labelKey`, with a Search button. **Added on 26 November
  2026** for the records kit's barcode lookup
  ([its README](../../business-apps/packages/records-demo/README.md)):

  ```json
  {
    "version": 2,
    "labelKey": "records.queue.barcode-lookup",
    "pageProvider": "records_physical_by_barcode",
    "search": { "labelKey": "records.lookup.barcode", "open": "single" },
    "columns": ["phys:barcode", "dc:title", "phys:locationPath"]
  }
  ```

  The text, trimmed, is the page provider's **last parameter**, after the queue's own
  `parameters`: its query has one `?` more than they fill, `phys:barcode = ?` here. Nuxeo quotes a
  parameter as a literal before it reaches the query. Nothing is asked of the page provider until
  the person searches: the page says what to do instead, and an empty text is no search. Enter in
  the field searches, as a barcode scanner presses it after a code. **`"open": "single"`**: a
  search whose results are one record alone opens that record's page, as a row does; one that
  finds none says so, and one that finds several lists them. A preview, the layout designer's,
  never opens one. The search's only keys are `label`, `labelKey` and `open`, whose only value is
  `single`; a finding in the search refuses the queue, since without its search the page provider
  would be asked with a parameter too few.

### Where the app reads it

As the home (section 10): at `agentic-ui-config/queues/<id>.json`, beside the layouts, where the
development server serves it, and otherwise from the app registry, for the app open, at
`queues/<id>.json` below the app's root:

```bash
npm run config:dev -- --queue path/to/queues/unassigned-claims.json
```

`--queue` may be given once for each queue. Where neither serves it, the queue's page says that
no queue of that name is configured.

### What the app does with it

The app's page `/queues/<id>` reads the file, checks it with the validator, and draws it under its
name. The home's links to queues open it. The engine is `libs/shared/queues`, and its
`samples/documents/queues/documents.json` is a queue on the platform's own `default_search` page
provider, for the development server.

- **A `structure` finding** draws no queue: the page says the queue could not be read, and the
  console names the findings.
- **An `unknown` or a `parameter` finding** leaves out the column, facet, row action or bulk action
  it is in, and the console says why; one of the file's own keys is ignored. A column the list
  cannot draw is left out as in a related-records card, and a queue with no column left is one
  that could not be read.
- **The list** is the record page's (layout-v2.md, section 7): the page provider's records page by
  page, the columns through their widgets, the order sorted on the server from a header, a row
  opening its record, and the row actions that have a handler on the page, the platform's five
  among them, which the app registers once for every list. After one of them changes a record, the
  list reads its page again, with its buckets chosen. A column with a rule
  shows to the people it passes for, answered as the queue's own rule is; a queue none of whose
  columns is for the person signed in is hidden from them.
- **An empty parameter** refuses the queue, as a related list is not asked with one: a page
  provider asked with an empty value matches what its author did not mean, or nothing.
- **A facet** is drawn from the page provider's `aggregations` in the results, a bucket per value
  with its count, and choosing one sends it back as the search page sends its filters: a parameter
  named after the aggregate, its chosen keys a JSON array, such as
  `claim_type_agg=["medical","dental"]`. The list keeps the records in any chosen bucket of one
  aggregate and in every aggregate chosen in, and starts again on its first page. A facet the
  results have no aggregate for is not drawn, and the console says why: a page provider that
  queries the repository has none. An aggregate named as the search's own parameters are, such as
  `pageSize`, or with a `.` or a `-`, cannot be sent back, and its facet is left out.
- **A facet with `"widget": "document-link"`** shows each bucket by the title of the record its key
  names, and still sends the key back when it is chosen. **Added on 26 November 2026** for the
  moves kit's Move facet ([its README](../../business-apps/packages/moves-demo/README.md), "Phase 8
  feedback", item 4). The titles are read as a `document-link`'s are
  ([layout-v2.md](layout-v2.md), section 11): one search for every bucket's id at once, through the
  REST API as the reader, only keys that are documents' ids sent, each as a query parameter of its
  own. The queue keeps one lookup for as long as it is drawn, which its list shares, and asks with
  the schemas its columns' `show` read, as the list does (layout-v2.md, section 12), so a record a
  cell and a bucket both name is read once. **Where a title cannot be read, the bucket shows its
  key,** the stored id: a record the reader may not read, one that no longer exists, a key that is
  not an id, a search that failed, and a record still being read. Unlike a `document-link` cell,
  which says "Unavailable", a bucket needs a text that tells it from the others to be chosen, and
  the key is what the server's aggregate already returned to the reader.
- **Selecting rows** offers the queue's bulk actions in the app's selection bar: those that the
  `bulk-actions` slot resolves and that have a handler on the page, as row actions are offered.
  Choosing a bucket clears the selection. Rows cannot be selected when no bulk action is offered.
- **An action of the package's own**, from `actions.json`, is offered on the rows when it runs an
  operation on `row` and the app registry serves it: the app registers it at startup (section 5).
  Its lifecycle buttons, and its bulk actions, are left out of the rows and the selection bar, and
  the console says why.
- **The rule** is the rule registry's, evaluated with the person, their groups and no record. The
  page is hidden while it does not pass, and asks the page provider for nothing. A rule this build
  does not register, one nested deeper than the registry answers, or a finding in it, hides the
  queue from everyone: the registry would pass it, and show the queue to everyone.
- **Hiding a queue is not a security control.** The address still answers, and the page provider
  returns only what the person may read.
- **Every result of the query.** While rows are selected, a queue offering a bulk action that can run
  over a whole query ([extension-reference.md](../extension-reference.md), section 5) offers to
  select all its results, with their number. Every result selected, the page offers those actions
  in place of the selection bar, and rows cannot be selected meanwhile.
  - **It always confirms,** naming the number of records. The action then runs on the server through
    Nuxeo's Bulk Action Framework, over the page provider with the queue's parameters. The page shows
    its progress as it reads the command's status, offers to stop it, and says how it ended: done,
    done with some records failed, stopped, refused by the server, an answer the page could not
    read, or no longer followed, in the last two cases saying it may still be running. An action that
    changes records reads the list again when it ends, and once more a few seconds later, since a
    list the search index serves may still hold the records changed; until that second read, it
    names no count.
  - **Not while a bucket is chosen.** The server builds the command from the page provider's query
    and leaves out the buckets chosen, so it would reach records the list does not show. The page
    says to clear the filters instead.
  - **Not without a count.** A page provider whose results give no number of records cannot have all
    of them selected: the confirmation must name it.
  - **More than agreed.** The command is limited on the server to one record more than the person
    agreed to (`queryLimit`), so a query that has come to hold more records, or a parameter the server
    leaves out, reaches that many at most. When the server reports the one more, the page stops the
    command and says so. A fast action such as `trash` has usually processed them all by then: the
    limit is what bounds it. A count above the limit says the server did not keep to it, and the
    page says that too.
  - **Stopping** stops the command on the server. The batches already started still finish and count,
    so the page waits a while for them before it gives the number processed, and says when it could
    not.
  - **Leaving the page** stops following the command, not the command: it goes on on the server.
  - **The server decides** who may run which action and on which records, as for every action.

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
      "icon": "health_record",
      "on": ["record", "row"],
      "visibleWhen": { "type": "app.rules.inState", "parameters": ["pending"] },
      "enabledWhen": "app.rules.canWrite",
      "operation": "Payers.RequestMedicalRecords",
      "parameters": {
        "provider": { "field": "claim:provider" },
        "note": { "field": "var:note" },
        "urgent": false
      },
      "form": [
        {
          "field": "var:note",
          "label": "Note to the provider",
          "widget": "long-text",
          "required": true
        }
      ],
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

| Key                  | What it is                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | Required, and the package's own. A manifest cannot rebind an action registered in code ([extension-reference.md](../extension-reference.md), section 1): neither an id starting `app.` or `core.`, which is the platform's, nor one a customer registers in Layer 2 code, in any slot, which the deployment lists for the pipeline |
| `label`, `labelKey`  | The button's text. One of them is required                                                                                                                                                                                                                                                                                         |
| `icon`               | An icon of the platform's icon set, such as `check`                                                                                                                                                                                                                                                                                |
| `order`              | A whole number. Lower comes first                                                                                                                                                                                                                                                                                                  |
| `on`                 | Where it shows: `record`, the record page's toolbar; `row`, a queue's row menu; `bulk`, a queue's selection. `["record"]` when left out                                                                                                                                                                                            |
| `visibleWhen`        | A rule: the button shows while it passes                                                                                                                                                                                                                                                                                           |
| `enabledWhen`        | A rule: the button shows, and cannot be chosen, while it does not pass. Both rules are checked again before the action runs                                                                                                                                                                                                        |
| `transition`         | A lifecycle transition. The button shows only when the record's lifecycle allows it, as phase 2's allowed-transitions enricher says                                                                                                                                                                                                |
| `operation`          | An Automation operation or chain, on the deployment's allow-list                                                                                                                                                                                                                                                                   |
| `parameters`         | The operation's parameters: each name to a literal, a field of the record, `{ "field": "<prefix>:<name>" }`, or a field of the action's form, `{ "field": "var:<name>" }`. Not a computation                                                                                                                                       |
| `form`               | The fields the person fills in before it runs, each `var:<name>`, written as a task form's fields are (section 6): widgets, rules and checks                                                                                                                                                                                       |
| `confirm`, `success` | `{ "label" }` or `{ "labelKey" }`: a question before it runs, and a message after                                                                                                                                                                                                                                                  |
| `refresh`            | Whether the record and the lists are read again afterwards. True when left out                                                                                                                                                                                                                                                     |

- **One of `transition` and `operation`.** Parameters and a form belong to an operation only.
- **The allow-list is the deployment's** (plan decision 3, built on its recommendation, which is
  still open: [decisions.md](decisions.md), notes). It is a contribution to
  `org.nuxeo.agentic.ui.operations`'s `allowList` point that the server's administrators install,
  a file in `nxserver/config/`, naming each operation or chain a button may run, the permission
  the person needs on the record, `Write` by default, and each parameter an app may give it, with
  its type, where its value may come from, and whether it is required. It may narrow each further:
  the apps whose buttons may run it, the groups the person must be in one of, and the types and the
  lifecycle states of the records it runs on. The server checks every one of them itself, whatever
  the button's own rules said:

  ```xml
  <extension target="org.nuxeo.agentic.ui.operations" point="allowList">
    <operation id="Payers.RequestMedicalRecords" permission="Write">
      <app>payers-claims</app>
      <group>claims-adjusters</group>
      <type>Claim</type>
      <state>inReview</state>
      <param name="provider" type="string" maxLength="64" source="field:claim:provider" />
      <param name="note" type="string" maxLength="500" source="input" required="true" />
      <param name="urgent" type="boolean" source="input" />
    </operation>
  </extension>
  ```

  A type is `string`, `boolean`, `long` or `double`; a string is at most `maxLength`
  characters, 1000 by default, and holds no control character but a tab or a line break. A source
  is `input`, the action's form, `literal`, the app's file, or `field:` and a property of the
  record as stored; any of them when left out.

  **A package never contributes it.** The server reads it only from its configuration directory, in
  whose context the runtime deploys that directory's files, and refuses, and logs, a contribution
  from a bundle; the pipeline refuses a package that contributes to it, the target written with
  or without its `service:` type, too, and one that could write into `nxserver/config/` when it
  is installed: a deployment fragment, or an `install.xml` doing more than copy its bundle. So no
  package the pipeline built can widen it. One it did not build is checked by nothing but the
  administrators who install it. Never allowed, whoever contributes them:
  the platform's own `AgenticUi.` operations, and those that run another operation, a script or as
  another user, such as `RunOperation` or `Auth.LoginAs`, any of which would allow everything. An
  entry that fails a check is not registered, and takes an entry of its id that was before it out
  with it, so that a narrowing with a typo does not leave the wider one in force.

- **The pipeline holds a package to an allow-list too,** that of the deployment it is built for, as
  a file of operation ids, shown below: a package naming an operation it does not hold is refused,
  and with none every operation is. That is the build's check; the server's contribution is the
  control.
- **The registry serves only what the server's allow-list lets run.** An action whose operation is
  not on it, that gives a parameter it does not allow, or a literal of another type, is left out
  of the `actions.json` the app registry serves (section 10), and its diagnostics say why. A file
  with nothing left out is served as the package wrote it. A lifecycle button is served as it is.
- **The server runs it, through `AgenticUi.RunAction`,** an Automation operation of
  `nuxeo-agentic-core` ([api-integrations.md](../api-integrations.md), section 40). The request
  names the app, the action, the record and what was entered in the form, never the operation. The
  server checks the person's `Read` on the record, that an app of theirs serves the action, the
  allow-list again, its app, its groups and its permission, the record's type and state, then builds
  the parameters itself: literals from the file, fields from the record as the repository stores
  it, and the form's values, each from where and of the type the allow-list says, a required one
  never empty nor white space alone. Anything else the request holds is refused, or never read. It
  runs the operation as the person, in an Automation context of its own, then writes "App action
  run" to the record's history.
- **A computation is refused as a parameter:** it is worked out in the browser, and the server,
  which builds the parameters, does not run one.
- **A bulk action's parameters are literals,** and it has no form: it runs on many records at once,
  so no one record's field can give it a value. The app does not run bulk actions from this file
  yet.
- **The server decides.** Nuxeo's permissions and the lifecycle gate every operation and every
  transition, and the allow-list every button. Hiding or disabling a button is not a security
  control, and the allow-list is not one over Nuxeo's own Automation endpoint, which still runs any
  operation a person may run, directly or through a dispatcher such as `RunOperation`, past any
  REST binding the chain has. **A chain meant to run only through a button begins with
  `AgenticUi.RequireRunAction`,** naming itself: the step lets the chain go on only while
  `AgenticUi.RunAction` runs it, a mark the server sets for the run and nothing a request carries
  can set, and refuses everyone else, administrators included. The Payers kit's two chains do. An
  operation allow-listed as itself has no first step, and stays reachable through Nuxeo's endpoint,
  so chains are what the allow-list should name. **And a button never runs what Nuxeo's endpoint
  keeps from the person:** `AgenticUi.RunAction` applies the operation's REST binding, disabled,
  for administrators or for some groups, as that endpoint does; a chain meant for a button has no
  binding. If either of the platform's two operations is replaced on the server, by a chain or an
  alias of its id, the registry serves no button that runs an operation, and nothing runs.

The allow-list the pipeline reads, for the deployment a package is built for:

```json allow-list.json
{
  "operations": ["Payers.RequestMedicalRecords", "Payers.AssignToCurrentUser"]
}
```

### Where the app reads it, and what it draws

- **From the app registry alone,** for the app open, once at startup, since the toolbar and the
  row menus are drawn from registries read then. The development server never serves
  `actions.json`: a file it served would be one the server's allow-list had not filtered. With no
  app open, before sign-in or on a server with no registry, no button is offered.
- **An action on `record`** is a button on the document page's toolbar, and one on `row` an entry of
  every list's row menu where the list names it: a queue's `rowActions`, or a related list's. Its
  `visibleWhen` decides where it shows, and its `enabledWhen` whether it can be chosen.
- **Chosen,** its rules are checked again with the record it was chosen on, then a dialog asks its
  question, its `confirm` or the platform's naming the record, with its form drawn by the version 2
  form engine as a task form is. Run, the form's own checks must pass; the record is read again
  from the server, and both rules are checked a third time, on what it is now; only then is the
  server asked. Its `success` message, or the platform's, says it ran. A refusal or a failure is
  said in the dialog, which stays open with what was entered.
- **Afterwards,** unless `refresh` is false, every list reads its page again, the record page's
  timeline its history, and the document page the record.
- **What is left out,** and the console says why: an action with a finding or a rule this build
  cannot answer, as for a queue (section 12); a lifecycle button, which the platform's own Change
  state offers; an action on `bulk` alone; and, when it is chosen, one whose form has a field the
  form engine cannot draw as one value, such as an address, which would run without it.

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
  and `var:` means nothing in any other file, wherever a property can be written: a field, a
  value, a template's placeholder or a widget's parameter. So `var` is not a prefix any schema of
  the content model can use in an app definition.
- **The record's own properties**, such as `claim:billedAmount`, show read-only. A value may still
  read them, as the check above does.
- **The buttons** are the step's own, from the workflow: approve and deny, here. Whether a field
  can be required for one button only is phase 2's to decide.

### Where the app reads it, and what it draws

- **The address.** The app reads `tasks/<workflow>.<step>.layout.json` beside `layouts.json`, as
  the package writes it, with no envelope, as it reads `home.json` (section 10). `<workflow>` is
  the task's `workflowModelName` and `<step>` its `nodeName`, the step's node id.
- **What happens when there is none.** Nothing served there (HTTP 404) leaves the task panel's own
  form, and so does a file refused for a structural error.
- **Who serves it.** As the home (section 10): the development server, from
  `npm run config:dev -- --task <workflow>.<step>=<file>`, and otherwise the app registry, for the
  app open, when its package contributes the file. The configuration servlet does not.
- **Where the form is drawn.** It is in the task panel, in place of the panel's participants
  fields; the panel keeps its comment and the step's buttons. The component is `lib-task-form` in
  `libs/shared/document-layouts`, registered as `nxs.components.taskForm`, so a customer library
  can replace it.
- **How it is drawn.** It is an edit form of layout version 2, as layout-v2.md, section 11,
  describes one, over the record the task is on, its first target document, read with all its
  properties.
- **A `var:` field's type and value.** Its type comes from the step's variable schema, `var_<step>`,
  which the task names in `taskInfo.schemas`, or from the workflow's, `var_<workflow>`. Its value
  is the task's `variables`. A `var:` field naming neither schema's field is left out, as a field
  its type lacks is.
- **The record's own properties** show read-only, through their widgets.
- **The step's buttons** are its `taskInfo.taskActions`:
  - one that validates (`validate`, true unless Nuxeo says otherwise) checks the form first, then
    completes the task with `PUT /api/v1/task/{id}/{action}`, sending the form's variables by name
    and the comment;
  - one that skips it, such as Cancel, sends none of the form.
- **The server's validation messages** go on the fields they name. A property
  `var_<schema>:<name>` is the field `var:<name>`; the messages the form cannot place are said in
  the panel's toast.

## 7. Labels

```json labels/en.json
{
  "version": 2,
  "labels": {
    "payers.app.claims": "Claims",
    "payers.queue.unassigned": "Unassigned claims",
    "payers.action.requestRecords": "Request medical records",
    "payers.action.requestRecords.sent": "Medical records requested",
    "layout.schema.claim": "Claim",
    "layout.field.claim:memberId": "Member ID"
  }
}
```

- **One file per language**, named by its language tag, as the platform's catalogues are: `en`,
  `fr`, `de`, `ja` and `nl` today, or one with a region, such as `pt-BR`.
- **A key** is the app's own, best begun with the app's name, or the platform's, such as
  `layout.field.claim:memberId`, which this replaces in this language. Version 1's manifest
  `labels` replace a key in every language at once.
- **The Properties panel's names** are two of the platform's keys. `layout.schema.<schema>` heads a
  schema's section where the panel is generated, for a type with no `metadata` layout file
  (layout-v2.md, section 1), by the schema's name, not its prefix: the facilities kit's
  `layout.schema.workorder` names the schema `workorder`, whose prefix is `wo`. A layout file's
  sections name their own headings. `layout.field.<prefix>:<field>` names a field, generated or in
  a layout file that gives it no `label` or `labelKey` that translates. With no text, a generated
  heading is the schema's name made readable, so a kit's own schema shows as a raw name:
  `acmeproduct` is "Acmeproduct". Give each schema of a kit's own types a heading:
  `kit-schema-labels.spec.ts`, in `libs/shared/document-layouts`, holds the kits under
  `business-apps/packages/` to it, from each kit's `content-model.json`.
- **A text** is not empty.
- **Every key a package names has a text** in its `labels/en.json` or in the platform's English
  catalogue: the pipeline refuses one with neither, by its key and its file
  ([package-pipeline.md](package-pipeline.md), section 2).
- **Looking a key up:** in the person's language, in the package first and then in the
  platform's catalogue. A customer's manifest `labels` still win over both.
- **How the app reads them:** for the person's language, and for the fallback language through
  the platform's own fallback, and only in a language something lists, so that nothing is asked
  for that is not there. The development server's layouts index (`layouts.json`) lists the
  languages `npm run config:dev -- --labels <lang>=<file>` serves at `labels/<lang>.json`, beside
  `bootstrap.json`. The app registry lists the app open's files, `labels/<lang>.json` among them,
  so on a server the registry's listing takes the place of the index's `labels`. A language both
  list is read from the development server first, as every file is (section 10). A listed file
  that cannot be read, a file that is not a version 2 labels file, and a key or a text the
  validator refuses are each said in the console; the rest still loads.
- **The labels are read once, at startup.** A person who switches app, or signs in as someone
  whose app differs, gets a reloaded page, and the new app's labels with it (section 10). A card
  that names its heading by a key with no text still shows its `id`, made readable (layout-v2.md,
  section 2).

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

## 9. The menu

```json navigation.json
{
  "version": 2,
  "entries": [
    { "id": "home", "label": "Home", "icon": "home", "page": "home" },
    {
      "id": "unassigned",
      "icon": "inbox",
      "queue": "unassigned-claims",
      "visibleWhen": {
        "type": "app.rules.inGroup",
        "parameters": ["claims-adjusters", "claims-supervisors"]
      }
    },
    { "id": "tasks", "label": "My tasks", "icon": "task_alt", "page": "app.navbar.tasks" },
    { "id": "search", "label": "Search", "icon": "search", "page": "app.navbar.search" }
  ]
}
```

| Key                 | What it is                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                | Required, and used once in the file                                                                         |
| `queue`             | A queue of the package, by its id: `unassigned-claims` is `queues/unassigned-claims.json`                   |
| `page`              | `home`, the app's home (section 10), or a platform page, by its menu entry's ID, such as `app.navbar.tasks` |
| `label`, `labelKey` | The entry's text. A page needs one; a queue shows its own name when it has none                             |
| `icon`              | A Material Symbols name, such as `inbox`                                                                    |
| `order`             | A whole number. Lower comes first                                                                           |
| `visibleWhen`       | A rule                                                                                                      |

- **One of `queue` and `page`.** An entry opens one thing. A record has no entry: a queue or the
  home opens it.
- **A page by its menu entry's ID**, not by its address: the IDs of
  [extension-reference.md](../extension-reference.md), section 3, are a public contract, and an
  address can change. A deployment's own pages, registered in a manifest or in Layer 2 code, are
  named the same way.
- **No record is open** in the menu, so a rule there is given literals: a `{ "field" }` value is a
  `parameter` finding.
- **Hiding an entry is not a security control.** The route still answers, and the page provider
  behind a queue still returns only what the person may read.
- **Joined to the platform's menu, for now.** The app reads `navigation.json` once, at startup, as
  the home is read (section 10): at `agentic-ui-config/navigation.json` beside the home, where the
  development server serves it (`npm run config:dev -- --navigation <file>`), and otherwise from
  the app registry, for the app open. It adds its entries to the shell's menu, the `navbar` slot,
  after the platform's own unless an entry's `order` places it among them:
  - an entry for a queue opens the queue's page, `/queues/<id>` (section 4), and with no name of its
    own shows the queue's, read from its file, or its id;
  - the entry for `home` opens `/home`;
  - an entry for a platform page, such as `app.navbar.tasks`, is not added: the platform's own
    entry for it is in the menu already, and the console says so;
  - each is shown by its rule, as the person signed in. An entry whose rule this build cannot
    answer is left out, as a home's card is;
  - an entry's `icon` is looked up in the shell's icon set, Satori's, not in Material Symbols.
    `inbox` and `home` are in both; `task_alt`, the example's, is not in Satori's.

  Whether an app's entries replace the platform's or join them is still for the shell that switches
  apps (section 13); joining them leaves every platform page reachable meanwhile.

## 10. The home

```json home.json
{
  "version": 2,
  "label": "Claims",
  "cards": [
    {
      "id": "unassigned",
      "label": "Unassigned claims",
      "kpi": { "pageProvider": "payers_unassigned_claims" },
      "queue": "unassigned-claims",
      "visibleWhen": { "type": "app.rules.inGroup", "parameters": ["claims-adjusters"] }
    },
    {
      "id": "unassigned-by-type",
      "label": "Unassigned, by claim type",
      "kpi": { "pageProvider": "payers_unassigned_claims", "aggregate": "claim_type_agg" },
      "visibleWhen": { "type": "app.rules.inGroup", "parameters": ["claims-adjusters"] }
    },
    {
      "id": "pending",
      "label": "Pending determination",
      "kpi": {
        "pageProvider": "payers_open_claims",
        "aggregate": "claim_state_agg",
        "bucket": "pending"
      },
      "visibleWhen": { "type": "app.rules.inGroup", "parameters": ["claims-supervisors"] }
    },
    {
      "id": "unassigned-queue",
      "queue": "unassigned-claims",
      "visibleWhen": { "type": "app.rules.inGroup", "parameters": ["claims-supervisors"] }
    }
  ]
}
```

| Key                 | What it is                                      |
| ------------------- | ----------------------------------------------- |
| `label`, `labelKey` | The home's title. "Home" shows when it has none |
| `cards`             | Required: the cards, in the order they show     |

A card:

| Key                 | What it is                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `id`                | Required, and used once in the file                                                                |
| `kpi`               | A figure: what it counts, below                                                                    |
| `queue`             | A queue of the package, by its id. With a `kpi`, the card links to it; alone, the card is the link |
| `label`, `labelKey` | The card's title. A KPI needs one; a link to a queue shows the queue's own name when it has none   |
| `visibleWhen`       | A rule: who sees the card                                                                          |

A KPI:

| Key            | What it is                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------- |
| `pageProvider` | Required: a page provider defined on the server                                              |
| `parameters`   | Its parameters, in order: literals                                                           |
| `aggregate`    | One of the page provider's aggregates, named as the server defines it, as a queue's facet is |
| `bucket`       | The key of one of the aggregate's buckets                                                    |

- **A home per group** is cards whose rule is `app.rules.inGroup`. A person in two groups sees
  both groups' cards. A card with no rule is everyone's.
- **What a KPI shows**, from the page provider's results
  (`GET /api/v1/search/pp/<pageProvider>/execute`):
  - with no `aggregate`, how many records it returns: `resultsCount`;
  - with an `aggregate` and a `bucket`, how many are in that bucket: its `docCount` in
    `aggregations`, or 0 when the server returns no such bucket, as a terms aggregate does for an
    empty one;
  - with an `aggregate` alone, how many records it returns, and under it the buckets the server
    returns, each with its count, in the server's order.
- **A terms aggregate returns only its largest buckets,** as many as its `size` (10 when it sets
  none). When it returns that many, a bucket missing from them may be one it left out, so a KPI on
  it says its figure is unavailable rather than 0, and a list of buckets says it shows the largest
  only. Range and histogram aggregates return every bucket they define.
- **Aggregates come from the search index.** A page provider that queries the repository has
  none, and a KPI that names one says the figure is unavailable.
- **One request per page provider and parameters**, however many cards read it, with a page of one
  record. A hidden card asks for nothing.
- **No record is open** on the home: a page provider's parameters are literals, as a queue's are,
  and a rule is given literals. That holds for a customer's own rule too: the validator cannot
  type its parameters, but a `{ "field" }` among them, at any depth, is a `parameter` finding.
  And a registered rule among them, which a customer's composite may resolve, is checked as a
  rule, its parameters included, in every file.
- **A figure is not a security control,** and not an audit either. It counts what the page provider
  returns to the person signed in, and hiding a card hides the figure, not the records.

### Where the app reads it: the development server, then the app registry

On a server, the app registry in `nuxeo-agentic-core` serves `home.json` with the rest of the
app, after sign-in. Under `nx serve`, the development server serves it, from `npm run config:dev`.
The app reads every file of an app definition the same way, the home, the menu, a queue, a labels
file and a task form, as the package writes it, with no envelope:

1. **Where the development server serves it,** beside the layouts: `agentic-ui-config/home.json`.

   ```bash
   npm run config:dev -- --home path/to/home.json
   ```

2. **Where that is 404, from the app registry,** for the app open, when it has the file:
   `/nuxeo/agentic-ui-apps/apps/<id>/home.json`, read with the person's credentials. On a server
   the first address is always 404: the configuration servlet answers only `bootstrap.json`,
   `manifest.json`, `layouts.json`, its layout files and `assets/`, to everyone, before sign-in.
3. **Where neither serves it,** there is no home, and the home page says that none is configured.

So a file `config:dev` writes wins, even when the server behind the development server has a
registry, and is read without waiting for the registry. Two things differ from before the
registry under `nx serve` against a server that has one: what `config:dev` does not serve comes
from the registry, and a sign-in that opens an app reloads the page once. A registry that does
not answer, on a server without one or before anyone signs in, is one with no app.

**The app registry.** Built on 24 November 2026 against the decision log's proposed answers to B
and E, which are still open ([decisions.md](decisions.md), notes):

- **What a package contributes:** its app, to the configuration's extension point,
  `org.nuxeo.agentic.ui.config`, beside its layouts:

  ```xml
  <app id="payers-claims" src="agentic-ui-config/app.json">
    <file path="home.json" />
    <file path="navigation.json" />
    <file path="queues/unassigned-claims.json" />
    <file path="labels/en.json" />
    <file path="tasks/claimReview.determine.layout.json" />
    <file path="actions.json" />
  </app>
  ```

  `src` is the app's `app.json` in the bundle. Each `file` is a path below the directory that
  holds it, at one of section 1's places: `home.json`, `navigation.json`, `actions.json`,
  `queues/<id>.json`, `labels/<lang>.json` and `tasks/<workflow>.<step>.layout.json`. Each file
  is named, as a layout is, and the pipeline's step 2 holds the list to the package's files
  ([package-pipeline.md](package-pipeline.md)). The `app-package` generator writes the element,
  the generators that add a file keep it in step, and `app-registry` writes it for a package
  without one, or after a file is written by hand. A later app with the same id replaces it whole, and
  `enabled="false"` removes it. Layouts are still contributed as `<layout>`, and served to
  everyone (section 13).

- **Who sees an app:** `GET /nuxeo/agentic-ui-apps/apps.json` lists the apps whose `app.json`
  names a group the person is in. Every group Nuxeo counts them in counts, nested and virtual ones
  included, so `members` is everyone signed in. An administrator sees what their groups give them,
  like anyone. A request with no credentials is 401, or, on a server that defines an anonymous
  user, `Anonymous`, who is in no app's group unless an app names one of theirs. Groups only:
  tenants are phase 9's (decision G).
- **Seeing an app is not a security control.** The groups decide which apps the shell offers. An
  app definition holds no record, and Nuxeo's permissions still decide which records its queues,
  homes and pages show. An app the person may not see is 404, as a file a package does not have
  is, and the person can still read, through the REST API, every record they have the right to.
- **What the server refuses,** as the configuration servlet refuses a fragment: a file over 1 MiB,
  one that does not parse as a JSON object, or one with a repeated key. An `app.json` that cannot
  be used, that names another app, or that names no groups refuses the app, and an app it would
  replace stays in force. Any other file is left out on its own. An app names at most 256 files,
  and its `src` is a relative path in its bundle. What was refused is in the listing's
  `diagnostics`, in the configuration envelope's form: for those who see the app, those its version in force made, and all of them
  for an administrator. None reaches the configuration's own responses.
- **What the shell refuses:** an app whose `app.json` has any finding, as section 12 says. "Switch
  app" does not list it, and the console says why.
- **The app open** is the one last chosen in this browser, when the person may still see it, and else the
  first the registry lists, in the order packages are registered. When they may see more than
  one, the settings menu offers "Switch app" (the development plan, phase 0's demo, step 3).
  Choosing one remembers it in the browser and reloads the page with it. A sign-in that changes
  the app open reloads the page too, once, so that the menu and the labels, read at startup, are
  the new app's.
- **The endpoint,** its responses and headers, is in
  [api-integrations.md](../api-integrations.md).

**The deployment layer.** Built on 25 November 2026, the designer's third slice, against the same
proposed answers to B and E ([decisions.md](decisions.md), notes). **It changes an app for every
user of it from an administrator's screen.**

- **What it holds:** a customer's own versions of an app's record pages, edit and create forms
  (`layouts/<Type>/<view|edit|create>.layout.json`) and queues (`queues/<id>.json`), made in the
  [layout designer](../../libs/features/layout-designer/README.md#publishing-the-deployment-layer)
  and kept in the server's repository. Nothing else of the app: not `app.json`, the menu, the home,
  the actions or the labels.
- **Its precedence:** the customer's overlay of the architecture's "starter kit, then customer,
  then tenant, then environment" ([architecture.md](architecture.md), section 10). A live file wins
  over the package's file at the same path, and adds one where the package has none, as a layout
  the `<app>` does not name. It does not touch the labels: a `labelKey` it names is looked up as
  before, so the manifest's labels, which win over an app's, win over it too.
- **Who sees it:** the registry serves each live file at its path, to the app's groups, after
  sign-in, and lists it in the app's `files` with its version under `layer`. The record page and the
  forms read a layer layout for the app open before the configuration servlet's
  (`DocumentLayoutService`); a queue is read from the registry already. **The configuration
  servlet, which everyone reads before sign-in, never reads a layer, drafts or live versions.**
  So someone in none of the app's groups keeps the package's file, as a server with layouts for
  two apps keeps one per type and mode for everyone else (section 13).
- **How a change goes live:** as a draft, which the registry never serves; submitted; and approved
  by an administrator who neither wrote nor submitted it, unless the server lets the same one. Every
  write is checked on the server with this document's validator, against the server's content
  model, and a file it finds anything in is refused. A queue is held to the app's `actions.json` as
  the registry serves it, after the allow-list (section 5): it names an action that runs an
  operation only while the allow-list lets that operation run, and a live one is checked again when
  the allow-list changes. Every publish keeps the previous version, and a rollback restores it. The
  switch, `nuxeo.agentic.ui.layer.enabled`, is off unless set.

### What the app does with it

The app's page `/home` reads the file, checks it with the validator, and draws it:

- **a `structure` finding** draws no home: the page says the home could not be read, and the
  console names the findings;
- **an `unknown` or a `parameter` finding** leaves out the card it is in, and the console says why;
  one of the file's own keys is ignored. A home whose every card is left out is one that could not
  be read;
- **a rule this build does not register,** at any depth, leaves out its card, and so does one
  nested deeper than the rule registry answers, 32 levels: the registry would pass either. The
  nested rules are a composite's parameters, and any `{ "type" }` among another rule's;
- **the rules** are the rule registry's, evaluated with the person, their groups and no record. An
  unregistered `app.rules.inGroup` hides its card, as the registry's security-relevant rules do;
- **a page provider the server does not have,** or a request it refuses, shows the card's title
  with no figure, and the console says why;
- **a link to a queue** opens the queue's page, `/queues/<id>` (section 4). The home reads no queue
  file, so a link with no name of its own shows the queue's id, not its name.

The engine is `libs/shared/home`, and its `samples/documents/home.json` is a home on the
platform's own `default_search` page provider, for the development server.

## 11. Checks across files

Each file is checked with its package's `app.json`, `actions.json`, `assets/` and `queues/`:

- a queue's row and bulk actions are the platform's, or defined in `actions.json` with `row` or
  `bulk` in `on`;
- a module's settings are for a module `app.json` turns on;
- a branding image in `assets/` is in the package;
- a queue the menu or the home names is in `queues/`;
- a file's name says what the file is: a queue's id, a workflow and a step, a language, a module;
- inside a package, a JSON file out of place, such as `queue/open.json`, is refused rather than
  passed over. Version 1's `bootstrap.json`, `manifest.json` and `layouts.json`, and whatever is
  in `demo/` and `assets/`, are left alone.

## 12. What is refused, and when

When the package is built, every finding refuses it, naming the file, the place and the problem.
When the app loads a file, what a finding does depends on its kind and on the file:

- **`unknown`:** a key, an id or a file that neither the platform nor the package has;
- **`parameter`:** a registered id given parameters it does not take.

| File              | A `structure` finding                                                 | An `unknown` or `parameter` finding                                                   |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `app.json`        | The app is refused, and "Switch app" does not list it                 | The app is refused too: the shell runs no app it cannot read whole                    |
| A queue           | The queue is left out                                                 | The column, facet or action it is in is left out. A key of the queue's own is ignored |
| `actions.json`    | The action it is in is left out; all of them, if it is the file's own | The action it is in is left out. A key of the file's own is ignored                   |
| A task form       | The task panel's own form shows instead                               | The card or field it is in is left out, as in a layout                                |
| A labels file     | The file is not applied: the platform's labels show                   | The key is ignored                                                                    |
| Module settings   | The app is refused, as for `app.json`                                 | The app is refused, as for `app.json`                                                 |
| `navigation.json` | The menu is not drawn: the platform's shows                           | The entry it is in is left out. A key of the file's own is ignored                    |
| `home.json`       | The home is not drawn: the page says so, and the console why          | The card it is in is left out. A key of the file's own is ignored                     |

- **`app.json` and module settings refuse the app** on any finding, an unknown key included. An
  app the shell cannot read whole would run half configured. A package that needs a later
  platform's keys says so in its platform range.
- **A settings file for a module the app does not turn on** is never read, so it refuses nothing
  when the app loads.
- **The menu's row** is what the app does: a refused file leaves the platform's menu alone.
- **Nesting.** The validator reads rules, computations, a customer's rule's parameters and fields
  (a table's columns are fields, and may be tables) 256 levels deep, in every file, layouts
  included. Deeper is a `parameter` finding, so that a file
  nested further than a check has stack for is refused or left out rather than crashing the check.

## 13. Not settled here

- **Decisions B and E** are open. The app registry is built against their proposed answers, and
  [decisions.md](decisions.md)'s notes say what changes if either is taken another way.
- **Decision 3 and the security review of operation buttons**, in phase 2. The allow-list is built
  on the decision's recommendation, per deployment, on the server (section 5); the decision, and
  the review that signs it off, are open.
- **Addresses by host name**, for tenants (decision G). `address` is a path only.
- **In task forms:** rules for one button only, and starting a workflow from a record with its
  start form.
- **In labels:** placeholders and plural forms, and a check that every key an app uses has a text.
- **Each module's settings schema**, which comes with the module.
- **Layouts per app.** The registry serves an app's other files; its packages' layouts are still the
  configuration servlet's, one per type and mode for the whole server, to everyone. Two apps with
  a layout for the same type and mode replace each other's. Only an app's deployment layer
  (section 10) has layouts per app, and only for the people in its groups with the app open.
- **The deployment layer per tenant**, and its labels, menu, home and actions: not built. A layer's
  queue names the actions the registry serves, after the allow-list (section 10).
- **Actions and module settings in the app.** The app runs an operation button on one record, on
  the toolbar or a row; not a lifecycle button from `actions.json`, which the platform's own Change
  state offers, nor a bulk action. The registry does not serve `modules/<module>.json`: no domain
  module exists yet.
- **An app's branding and address.** The shell does not yet apply `branding` from the app open's
  `app.json`, nor open it at its `address`.
- **The platform range in the shell.** The shell holds each listed `app.json` to the validator
  without its own platform version, which it does not know at run time; the pipeline holds the
  range to the server's.
- **A sign-in that changes the app open reloads the page.** The menu and the labels are read once,
  at startup, so that is how they become the new app's. A second change for the same person within
  30 seconds does not reload again.
- **Replacing the platform's menu.** The app joins its entries to the manifest's `navbar` slot
  (section 9). Whether an app's entries replace the platform's or join them is for the shell that
  switches apps, with the registry.
- **The home as the first page.** The app still opens `/dashboard` after sign-in; the home is at
  `/home`. Opening an app on its home is the shell's, with the registry.
- **A bucket's name.** A KPI's bucket shows its key, as the server returns it. A vocabulary's
  label for it is not looked up.
- **Sums.** The plan's KPI tiles are "counts and sums from page provider aggregates". A KPI counts
  only. A sum needs an aggregate that adds a property up. The aggregates measured here are terms
  and ranges, which count; whether a page provider can sum is not checked.
- **The other cards of a Studio home.** A Web UI home also holds the person's tasks, recently
  viewed documents and favourites, and lists a page provider's records in place. The menu opens
  the first three as platform pages (`app.navbar.tasks`, `app.navbar.recentlyViewed`,
  `app.navbar.favorites`); the home has no card for them yet, and a list in place is a link to a
  queue for now. The Studio migration writes such a list as a queue.
- **The person signed in as a page provider parameter.** A page provider names them on the server
  for now. The server already reads a parameter written `$currentUser` as the person's name, and
  `$currentRepository` as the repository's (`QueryExecutor` in `nuxeo-search-rest-api`
  2025.10.18), so a literal in a queue or a KPI can name them today. Whether version 2 says so is
  open.
- **Rules where there is no one record.** A queue's `visibleWhen`, and a bulk action's, can name a
  rule that reads a record, such as `app.rules.isType`, or a `{ "field" }` value, and there is no
  one record there for it to read. The menu and the home refuse a `{ "field" }` value already.
  Rules do not yet say what they read, so a rule that reads a record passes there, and with no
  record it hides what it gates. Phase 1 decides whether rules will say, so that the validator can
  refuse these too.
- **Related-records lists** keep the platform's row actions. Whether they also take the package's
  own is phase 1's to decide.
