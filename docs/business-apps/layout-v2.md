# Layout file version 2

**Proposed, 22 November 2026, for review.**

- **Phase 0** writes the schema and the validator from this document.
- **Phase 1** renders it: record pages and forms, and the widget and computation registries
  ([development plan](development-plan.md)).
- **The Studio migration** writes it too ([studio-migration.md](studio-migration.md)).

It follows decision 4 ([decision log](decisions.md)): registered computations and rules only, with
no expression language and no code in configuration.

## The short version

- **What version 2 adds.** It is what a business record page needs:
  - cards in the main area, with columns and tabs;
  - named widgets;
  - computed fields;
  - fields and cards shown or hidden by a rule;
  - related records;
  - the record's timeline and its comments;
  - in forms, fields that are required or read-only by rule, and checks across fields.
- **Version 1 files keep working**, unchanged. A file says which version it is, and nothing turns
  a version 1 file into a version 2 one.
- **Everything a file refers to is a registered ID**: widgets, computations, rules, checks and row
  actions. A file that names an ID the platform does not have is refused when its package is
  built, and the message names the file, the place and the ID. That refusal is step 1 of phase 0's
  demo.
- **Nothing in a file is a security control.** A hidden field is not a protected field: the server's
  permissions decide what anyone can read or change.

## 1. Where a layout file sits

It sits where version 1 does ([extension-reference.md](../extension-reference.md), section 9b).

- **One file per document type and mode**, in a configuration package. The configuration servlet
  serves it, and `layouts.json` indexes it.
- **The modes:**

| Mode       | Where it shows                                | New in version 2 |
| ---------- | --------------------------------------------- | ---------------- |
| `view`     | The main area of the record page              | Yes              |
| `metadata` | The Properties panel beside it                | No               |
| `edit`     | The Edit form                                 | No               |
| `create`   | The Create form, for a new record of the type | No               |

A type with no file for a mode keeps today's generated layout for it. With no `view` file, the
record page is today's document page.

## 2. The shape of a file

```json
{
  "version": 2,
  "columns": 2,
  "cards": [
    {
      "id": "member",
      "label": "Member",
      "fields": ["member:fullName", { "field": "member:birthDate", "widget": "date" }]
    }
  ]
}
```

| Key       | Meaning                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------- |
| `version` | Required: `2`                                                                                  |
| `columns` | How many columns the cards fill, 1 to 3. Default 1. `view` mode only                           |
| `cards`   | The cards, in order                                                                            |
| `tabs`    | Or tabs, each holding cards: `{ "id", "label"?, "labelKey"?, "visibleWhen"?, "cards": [...] }` |
| `$schema` | Optional: the address of a JSON Schema, for editors, as version 1's fragments write it         |

A file has `cards` or `tabs`, never both.

### Cards

| Key                 | Meaning                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `id`                | Required, unique in the file: 1 to 64 letters, digits, `.`, `_` or `-` |
| `label`, `labelKey` | Its heading, as a literal or a translation key, as in version 1        |
| `span`              | How many columns it takes, up to `columns`. Default 1                  |
| `visibleWhen`       | A rule (section 5). The card shows only while it passes                |
| `fields`            | Its fields (below)                                                     |
| `related`           | Or a list of related records (section 7), in `view` mode only          |
| `timeline`          | Or the record's history (section 7), in `view` mode only               |
| `comments`          | Or the record's comments (section 7), in `view` mode only              |

A card has one of `fields`, `related`, `timeline` and `comments`.

In `metadata`, `edit` and `create` modes, cards show as the sections of the panel or the form.

### Fields

A field is written either as a `"<prefix>:<name>"` string, which shows the property with the widget its schema type picks, as in version 1, or as an object:

| Key                 | Meaning                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `field`             | The property, `"<prefix>:<name>"`                                                           |
| `computed`          | Or a computation (section 4) whose result the field shows. It then needs an `id`            |
| `id`                | Unique in the file. Required for a computed field, which is what checks and labels refer to |
| `label`, `labelKey` | As in version 1                                                                             |
| `widget`            | A registered widget (section 3). Without one, the schema type picks it, as in version 1     |
| `parameters`        | The widget's parameters, an object                                                          |
| `visibleWhen`       | A rule. The field shows only while it passes                                                |
| `required`          | Forms only: `true`, or a rule that makes the field required while it passes                 |
| `readOnlyWhen`      | Forms only: a rule that makes the field read-only while it passes                           |
| `checks`            | Forms only: checks across fields (section 6)                                                |

A field has `field` or `computed`, never both. A computed field is never editable.

## 3. Widgets

A widget says how one value is shown, and in a form how it is entered. It declares the property
types it accepts. A widget on a property of another type is refused wherever the content model is
known: by the app when it loads the page and by the pipeline when it is given the model, and the
designer and the migration server are to refuse it too (section 11).

| Widget          | For                            | Parameters                                                               | In a form                        |
| --------------- | ------------------------------ | ------------------------------------------------------------------------ | -------------------------------- |
| `text`          | `string`                       |                                                                          | A text field                     |
| `long-text`     | `string`                       | `rows`                                                                   | A text area                      |
| `rich-text`     | `string`                       |                                                                          | A rich text editor               |
| `number`        | `long`, `double`               | `decimals`                                                               | A number field                   |
| `currency`      | `long`, `double`               | `currency`: an ISO 4217 code, or a field holding one                     | A number field with the currency |
| `percent`       | `long`, `double`               | `scale`: `1` (0.12 is 12%) or `100` (12 is 12%)                          | A number field                   |
| `date`          | `date`                         | `format`: `short` or `long`                                              | A date picker                    |
| `relative-date` | `date`                         |                                                                          | A date picker                    |
| `boolean`       | `boolean`                      |                                                                          | A checkbox                       |
| `phone`         | `string`                       |                                                                          | A phone field                    |
| `email`         | `string`                       |                                                                          | An email field                   |
| `address`       | `complex`                      | `parts`: the subfields for street, city, postcode, country               | One field per part               |
| `user`          | `string`, `string[]`           |                                                                          | A user picker                    |
| `group`         | `string`, `string[]`           |                                                                          | A group picker                   |
| `vocabulary`    | `string`, `string[]`           | `directory`: the vocabulary                                              | A vocabulary picker              |
| `document-link` | `string`, `string[]`           | `types`: the document types it may link to                               | A document picker                |
| `chips`         | `string[]`                     |                                                                          | A chips field                    |
| `status-badge`  | `string`                       | `tones`: value to `positive`, `warning`, `negative`, `info` or `neutral` | A select                         |
| `table`         | `complex[]`                    | `columns`: field entries over the subfields                              | Rows to add, edit and remove     |
| `image`         | `blob`                         |                                                                          | An image upload                  |
| `file-list`     | `blob[]`, `complex[]` of files |                                                                          | File uploads                     |

- **Rich text** is shown through the platform's sanitiser, like every other HTML the app renders,
  and keeps formatting, lists, quotes, code and links only: no image, form, style or frame. It is
  the only widget that renders HTML.
- **A widget's text is the property's display value.** For a vocabulary, that is its label; for a
  user, their name.

## 4. Computations

A computed field shows a value worked out from others: decision 4's starting set. A computation
is referred to by ID, with parameters, as rules are today:

```json
{
  "id": "age",
  "label": "Age",
  "widget": "number",
  "computed": { "type": "core.age", "parameters": [{ "field": "member:birthDate" }] }
}
```

A parameter is one of:

- a literal: a text, a number or a boolean;
- a property, written `{ "field": "<prefix>:<name>" }`;
- another computation, written `{ "computed": { … } }`;
- for `core.choose`, a rule.

| Computation     | Parameters                                                               | Result                                                                                           |
| --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `core.age`      | A date                                                                   | The whole years from that date to today                                                          |
| `core.template` | A text with `{<prefix>:<name>}` placeholders                             | The text with each placeholder replaced by the property's display value. Always text, never HTML |
| `core.sum`      | A list, and for a list of complex values, the subfield                   | The sum of its numbers                                                                           |
| `core.count`    | A list                                                                   | How many items it holds                                                                          |
| `core.dateDiff` | Two dates (the second may be `"today"`), and `days`, `months` or `years` | The difference, in that unit                                                                     |
| `core.choose`   | A rule, then two values                                                  | The first value while the rule passes, the second otherwise                                      |

- **A computed field is text, never HTML,** so it cannot use `rich-text`: a template puts
  property values into its text, and anyone who may edit one would otherwise write markup on the
  page. The validator refuses it.
- **Anything else is registered in code.** A customer's own computation is a Layer 2
  registration, reviewed and built into the app, as a customer's own rule is today.
- **Every computation does bounded work on the record already loaded.** It makes no request and
  runs no customer code.

## 5. Rules

Shown and hidden fields, cards and tabs, and required and read-only fields, are all decided by
registered rules. They are written exactly as the manifest writes them today
([extension-reference.md](../extension-reference.md), section 4):

- a rule ID, such as `"app.rules.canWrite"`;
- or an ID with parameters: `{ "type": "app.rules.isType", "parameters": ["Claim"] }`;
- combined with `core.every`, `core.some` and `core.not`.

Version 2 adds three rules to the 29 or so that exist:

| Rule                | Parameters                  | True when                                                                  |
| ------------------- | --------------------------- | -------------------------------------------------------------------------- |
| `app.rules.fieldIn` | A property, then the values | The property's value is one of the values; for a list, any of its items is |
| `app.rules.inState` | The lifecycle states        | The record's lifecycle state is one of them                                |
| `app.rules.inGroup` | The groups                  | The user is in one of the groups                                           |

- **What a rule sees.** It is evaluated with the open record, the user and their groups. In a form
  it also sees the values being entered, so a field shown by another field's value appears as soon
  as that value is chosen.
- **A rule is never a security control.** A field hidden from a group is still readable through the
  API to anyone the server lets read it. Protecting a field is decision I, a platform decision.

## 6. Checks across fields

In a form, a field may carry checks that compare it with another field before saving:

```json
{
  "field": "claim:serviceEnd",
  "widget": "date",
  "checks": [
    {
      "type": "core.notBefore",
      "parameters": [{ "field": "claim:serviceStart" }],
      "labelKey": "acme.claim.endBeforeStart"
    }
  ]
}
```

| Check            | Parameters | Passes when                                     |
| ---------------- | ---------- | ----------------------------------------------- |
| `core.notBefore` | A date     | The field's date is not before the parameter's  |
| `core.atMost`    | A number   | The field's number is not above the parameter's |

- **A failed check stops the form from saving.** It shows its `label` or `labelKey` beside the
  field.
- **The server's own constraints still apply.** A check is a help to the person typing, not a
  guarantee.

## 7. Related records, the timeline and comments

A card can list records related to the open one, in `view` mode:

```json
{
  "id": "claims",
  "label": "Claims",
  "span": 2,
  "related": {
    "pageProvider": "member_claims",
    "parameters": [{ "field": "ecm:uuid" }],
    "columns": [
      "dc:title",
      { "field": "claim:amount", "widget": "currency", "parameters": { "currency": "USD" } },
      "claim:status"
    ],
    "sort": [{ "field": "dc:modified", "order": "desc" }],
    "pageSize": 10,
    "rowActions": ["app.rowActions.download"]
  }
}
```

| Key            | Meaning                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pageProvider` | Required: a page provider defined on the server                                                                            |
| `parameters`   | Its parameters, in order: literals, or properties of the open record such as `ecm:uuid`                                    |
| `columns`      | Field entries, with widgets, as in a card                                                                                  |
| `sort`         | The order, as `{ "field", "order": "asc" \| "desc" }` entries                                                              |
| `pageSize`     | 1 to 100. Default 10                                                                                                       |
| `rowActions`   | Registered row actions, by ID, such as `app.rowActions.download`. A row opens its record when clicked; actions add to that |

**Only page providers.** The plan's step 2 also listed an NXQL template in the layout. It is left
out on purpose:

- a query written in configuration is a query nobody reviewed;
- a page provider is defined on the server, which binds its parameters;
- Studio projects define their searches as page providers already.

### The timeline

A card can show the record's history, newest first, in `view` mode:

```json
{
  "id": "history",
  "labelKey": "payers.claim.timeline",
  "span": 2,
  "timeline": {
    "events": ["documentCreated", "documentModified", "lifecycle_transition_event"],
    "filter": true,
    "pageSize": 20
  }
}
```

| Key        | Meaning                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| `events`   | The kinds of event it shows, by the audit's event ID. Default: the record's own changes                         |
| `filter`   | `true` offers the reader a filter by kind of event, among `events` when it names more than one. Default `false` |
| `pageSize` | How many entries show first, and how many more each "Show more" adds: 1 to 100. Default 10                      |

- **Each entry says who, what and when:** the user by name, the kind of event and the audit's
  comment if it has one, and the time in the reader's own zone. A lifecycle transition also says
  the state it left and the state it reached.
- **The history is Nuxeo's audit** (`@audit`), filtered by kind on the server, so it is what the
  server recorded and what the user may read there.
- **The default kinds** are the record's own changes: `documentCreated`, `documentModified`,
  `documentCheckedIn`, `lifecycle_transition_event`, `documentLocked`, `documentUnlocked`,
  `documentMoved`, `documentPublished`, `documentSecurityUpdated`, `documentRestored`,
  `documentTrashed` and `documentUntrashed`. `download` is not one: Nuxeo audits every download,
  each thumbnail the app shows included, and they would fill the timeline.
- **An event is the server's to name,** as a page provider is: a Studio project's own event is
  named in `events` as the audit writes it, and its label is `document-layouts.timeline.event.<ID>`
  in the labels. A transition's entry is one sentence, `document-layouts.timeline.transition`, so
  that a translation orders its states as its language does.

### Comments

A card can show the record's comments and their replies, in `view` mode:

```json
{ "id": "notes", "labelKey": "payers.claim.comments", "comments": { "pageSize": 5 } }
```

| Key        | Meaning                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `pageSize` | How many of the newest comments, and of each one's newest replies, show first: 1 to 100. Default 10 |

- **Anyone who may read the record is offered the comment box,** and Reply on a comment. The server
  decides whether it takes the comment, and a refusal says so.
- **Edit and Delete are offered on the user's own comments,** and to an administrator on every
  one. The server's permissions still decide.
- It is the record's one thread, the one the Comments panel beside the page shows.

## 8. What is refused, and when

| When                                     | A structural error                                                   | An ID the platform does not have                                                  |
| ---------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| When the package is built (the pipeline) | The package is refused, naming the file and the place                | The package is refused, naming the file, the place and the ID                     |
| When the app loads the file              | The file is refused, and the generated layout shows, as in version 1 | That card, field, list column or row action is left out, and the console says why |

- **In a list of related records,** a finding about one column or one row action leaves out that
  one. A finding about the list itself, such as a key version 2 does not have, leaves out its card,
  and so does one about a timeline or comments.
- **Strict when built.** A package that reaches a server has already passed every check, so the
  app has little to refuse.
- **Tolerant when loaded.** A file written for a later platform still shows everything this one
  knows.

What counts as structural:

- not version 2;
- `cards` and `tabs` together;
- an `id` that is missing, malformed or used twice;
- a card with more than one of `fields`, `related`, `timeline` and `comments`, or none;
- a field with both `field` and `computed`, or neither;
- a computed field with no `id`;
- form-only keys in `view` mode, or `related`, `timeline` or `comments` outside it;
- a timeline's `events` that is empty, or names an event other than by its ID;
- a `span` over `columns`;
- a `var:` property, which only a task form has
  ([app-definition-v2.md, section 6](app-definition-v2.md#6-task-forms)).

`parameters` written as `null` is malformed, not absent.

## 9. An example: the Member page

The plan's first acceptance test is to rebuild the Payers Member page from the Web UI screenshot,
with no code. In version 2:

```json
{
  "version": 2,
  "columns": 2,
  "cards": [
    {
      "id": "member",
      "labelKey": "payers.member.card",
      "fields": [
        {
          "id": "name",
          "computed": {
            "type": "core.template",
            "parameters": ["{member:firstName} {member:lastName}"]
          },
          "labelKey": "payers.member.name"
        },
        {
          "id": "age",
          "widget": "number",
          "labelKey": "payers.member.age",
          "computed": { "type": "core.age", "parameters": [{ "field": "member:birthDate" }] }
        },
        {
          "field": "member:address",
          "widget": "address",
          "parameters": {
            "parts": { "street": "street", "city": "city", "postcode": "zip", "country": "country" }
          }
        },
        { "field": "member:phone", "widget": "phone" },
        {
          "field": "member:status",
          "widget": "status-badge",
          "parameters": {
            "tones": { "active": "positive", "lapsed": "warning", "terminated": "negative" }
          }
        },
        {
          "field": "member:ssn",
          "visibleWhen": { "type": "app.rules.inGroup", "parameters": ["member-services"] }
        }
      ]
    },
    {
      "id": "claims",
      "labelKey": "payers.member.claims",
      "related": {
        "pageProvider": "member_claims",
        "parameters": [{ "field": "ecm:uuid" }],
        "columns": [
          "claim:number",
          {
            "field": "claim:billedAmount",
            "widget": "currency",
            "parameters": { "currency": "USD" }
          },
          "claim:status"
        ],
        "sort": [{ "field": "claim:serviceDate", "order": "desc" }]
      }
    },
    {
      "id": "cases",
      "labelKey": "payers.member.cases",
      "related": {
        "pageProvider": "member_cases",
        "parameters": [{ "field": "ecm:uuid" }],
        "columns": ["dc:title", "case:state", { "field": "dc:modified", "widget": "relative-date" }]
      }
    }
  ]
}
```

The social security number is hidden from everyone outside member services, but that is a
convenience. Masking it for real, so that the API does not return it either, is decision I.

## 10. What the Studio migration writes

The converter of M1 writes version 2 for `view`. For `metadata`, `edit` and `create` it writes
version 1, which the app renders in those modes, while version 2 there is still refused (section
11): a field whose widget version 1 cannot name is written as its schema type shows it, and
reported. The [migration document](studio-migration.md), section 3, lists what each Web UI element
becomes. In version 2's terms:

| Web UI element                            | Becomes                                                          |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `nuxeo-input`                             | `text`, or `number` for a numeric property                       |
| `nuxeo-textarea`                          | `long-text`                                                      |
| `nuxeo-date-picker`                       | `date`                                                           |
| `nuxeo-date` with `format="relative"`     | `relative-date`                                                  |
| `nuxeo-user-suggestion`, `nuxeo-user-tag` | `user` or `group`                                                |
| `nuxeo-directory-suggestion`              | `vocabulary`, with its `directory-name` as `directory`           |
| `nuxeo-document-suggestion`               | `document-link`                                                  |
| `nuxeo-tag`                               | `chips`                                                          |
| `nuxeo-data-table` on a complex property  | `table`                                                          |
| `nuxeo-document-viewer`                   | Not a field: the record page shows a file record's preview first |
| A condition in a known pattern            | A rule, proven with truth tables (check 5)                       |

## 11. Not settled here

- **The schema and the validator are built**, in
  [`libs/shared/app-definition`](../../libs/shared/app-definition/README.md), with negative
  controls. Every JSON example in this document is one of its tests: a change here that the
  validator does not follow fails them. The package pipeline runs them
  ([package-pipeline.md](package-pipeline.md)), and so does the Studio migration's harness, check
  10, on every package M1 converts.
- **What the app draws so far.** A `view` file draws the record page, `RecordPageComponent` in
  `libs/shared/document-layouts`, loaded as section 8 says.
- **A card of related records** draws its list with `RecordListComponent`, in the same library,
  through the design system's document list:
  - the page provider is asked for one page at a time through `PageProviderService`, with each
    parameter sent whole, as a `queryParams` value of its own;
  - a `{ "field" }` parameter reads the open record, and `ecm:uuid`, `ecm:path`,
    `ecm:primaryType` and `ecm:currentLifeCycleState` are read where Nuxeo returns them. A
    parameter with no single value leaves the list unasked, and the card shows "No records";
  - each cell shows its row's property through its column's widget, held to the row's own type,
    which is read once per type;
  - a column's `visibleWhen` is evaluated for the open record, as a field's is;
  - the headers sort on the server, and a row opens its record;
  - a row offers the row actions the file lists, while their rules pass for that row.
- **A timeline's card** draws `RecordTimelineComponent`, in the same library:
  - it asks the record's audit, through `DocumentDetailService.getAuditLog`, for the card's kinds of
    event, newest first, `pageSize` entries at a time; "Show more" asks for the next page;
  - each entry names its user as a `user` field does, Nuxeo's own `system` excepted, and shows its
    time in the reader's zone ([pattern 29](../../AGENTS/08-bug-patterns.md));
  - the filter asks the server for one kind at a time, and "All events" for the card's kinds again;
  - it is refreshed in place when the page is given the record with another modification date,
    state or lock, or checked in or out, or put in or out of the trash: asked at once, and again
    2.5 seconds later, since Nuxeo writes its audit a moment after the change (0.8 to 1.4 seconds,
    measured). What a refresh brings joins the entries shown, which stay, unless more was
    recorded than a page holds: the timeline then starts again from that first page;
  - a timeline drawn anew, or given another record, is asked once more 2.5 seconds after it first
    is, too; another kind chosen in the filter is not. That is the refresh a reader of the
    document page sees: it draws the record page anew each time it reloads the record, after an
    edit or a transition and not after a lock, so the timeline starts again from its first page
    with every kind shown, and a comment half written in a comments card is lost. An audit slower
    than 2.5 seconds still lacks the change, until the record next reloads.
- **A card of comments** draws the platform's `nxs-comments`, the thread the Comments panel beside
  the page shows, with the card's `pageSize`.
- **The limits.** Each one that leaves something out is said in the console when a file meets it:
  - **a cell is one line of text:** a `status-badge` column shows its label without the tag, and
    a `phone` or `email` column shows its value without the link;
  - **a column shows a property once:** a second column naming the same property is left out,
    before any rule is evaluated, so two columns with opposite rules over one property cannot
    stand in for each other;
  - **a header sorts only a property with one value,** of a type a server can sort by. A sort the
    server refuses, such as a text field in OpenSearch, shows the error state, and retrying goes
    back to the file's order;
  - **a computed column** of a related list is not drawn yet, nor **a table in a list's cell**:
    that column is left out, and the rest of the list shows;
  - **a row action needs a handler where the list is.** The platform's `app.rowActions.*` are run
    by the browse list today, so a record page offers none of them until they are registered for
    the whole app. A customer's own row action, registered in Layer 2 code, is offered;
  - **a record with a file or a note**, such as a File, a Picture, a Video or a Note, or any
    record a facet gives the `file` or `note` schema, keeps its own View tab, its preview or its
    editor: a record page beside a preview comes later;
  - **a computed column** of a table is not drawn yet, nor **a table inside a table's column**:
    that column is left out, and the rest of the table shows;
  - **`image`, `file-list` and `document-link`** show the property's own value, a file's name or
    the stored id, until each has its lookup;
  - **a rule nested more than 32 levels deep** leaves its tab, card or field out: the rule
    registry answers no deeper, and past that it passes any rule not declared security-relevant,
    whatever the rule says;
  - **`metadata`, `edit` and `create` files of version 2** are still refused, and the generated
    layout shows.

  Three more are what the server records, measured on Nuxeo 2025, and the console does not say them:
  - **a transition is audited with the state it reached only.** The state it left is read from the
    entry before it among those the timeline shows. A transition with none before it says only
    where it went: the oldest one loaded, until "Show more" loads the next, and the first a record
    ever made, when the timeline shows state changes alone, by its `events` or by the reader's
    filter;
  - **a comment is audited as a modification of the record:** adding or editing one saves the
    record, so it shows as Modified, and the timeline on the same page shows it once the record
    reloads. A comments card and the Comments panel load the thread apart, and one shows a comment
    added in the other when it next loads;
  - **workflow events are not among the default kinds:** whether Nuxeo audits them against the
    record was not measured. A kit that wants them names them in `events`.

  Where this document is silent, the record page decides three things. **A template's placeholder**
  shows its property as the first field on the page that shows it does, through that field's
  widget and parameters, so a `user` field's id is a name there too; a property no field shows is
  shown by its schema type. **A date with no widget**, alone, in a list or inside a complex
  value, shows as the `date` widget shows one: a stored day as written, and an instant on the
  reader's day ([pattern 29](../../AGENTS/08-bug-patterns.md)). Version 1's view shows every date
  in UTC. **A computed field shown through `date` or `relative-date`** shows a result that is a
  date as Nuxeo writes one, a day or a date and time with its zone, such as the date property a
  `core.choose` gives; any other result is left out, and the console says why.

- **Checking widgets against property types** happens wherever the content model is known. The app
  checks each field against the type's schemas when it loads the page, and leaves out one whose
  widget does not show its property. The model reader, `readContentModel` in
  `libs/shared/app-definition`, reads the same model for the others: `validateLayoutV2`, given it
  and the type, finds a field whose property is on neither the type nor a facet it declares, a
  widget that does not show its property's type, and a table column naming a subfield its property
  lacks. Each is `unknown` or `parameter`, so loading stays tolerant. The pipeline holds a package
  to a model when it is given one ([package-pipeline.md](package-pipeline.md), section 4); the
  designer and the migration server are still to call it. Its limits:
  - a property that only a facet given at run time brings is refused, though the record page shows
    it on a record with that facet;
  - not checked: a related list's columns, which are other records'; the properties a computation,
    a rule or a widget parameter names; a task form's fields; and a vocabulary's `directory`
    against the property's own.
- **More widgets, computations and rules** join the registries as kits need them. A map, a
  signature or a chart is a kit's request, not version 2's.
- **Whether `metadata` mode should exist** once `view` does is phase 1's call, made once the
  record page is seen.
