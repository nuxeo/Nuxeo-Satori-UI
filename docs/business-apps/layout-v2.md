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

| Key                 | Meaning                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | Required, unique in the file: 1 to 64 letters, digits, `.`, `_` or `-`                                                                                                                                        |
| `label`, `labelKey` | Its heading, as a literal or a translation key, as in version 1. A key with no text, in the reader's language or the fallback one, shows the card's `id`, made readable; a card with neither shows no heading |
| `span`              | How many columns it takes, up to `columns`. Default 1                                                                                                                                                         |
| `visibleWhen`       | A rule (section 5). The card shows only while it passes                                                                                                                                                       |
| `fields`            | Its fields (below)                                                                                                                                                                                            |
| `related`           | Or a list of related records (section 7), in `view` mode only                                                                                                                                                 |

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

## 7. Related records

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

## 8. What is refused, and when

| When                                     | A structural error                                                   | An ID the platform does not have                                                  |
| ---------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| When the package is built (the pipeline) | The package is refused, naming the file and the place                | The package is refused, naming the file, the place and the ID                     |
| When the app loads the file              | The file is refused, and the generated layout shows, as in version 1 | That card, field, list column or row action is left out, and the console says why |

- **In a list of related records,** a finding about one column or one row action leaves out that
  one. A finding about the list itself, such as a key version 2 does not have, leaves out its card.
- **Strict when built.** A package that reaches a server has already passed every check, so the
  app has little to refuse.
- **Tolerant when loaded.** A file written for a later platform still shows everything this one
  knows.

What counts as structural:

- not version 2;
- `cards` and `tabs` together;
- an `id` that is missing, malformed or used twice;
- a field with both `field` and `computed`, or neither;
- a computed field with no `id`;
- form-only keys in `view` mode, or `related` outside it;
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
version 1, which the app renders in those modes: a field whose widget version 1 cannot name is
written as its schema type shows it, and reported. The app draws `edit` and `create` files of
version 2 too, and still refuses `metadata` ones (section 11); the converter does not write them
yet. The [migration document](studio-migration.md), section 3, lists what each Web UI element
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
  `libs/shared/document-layouts`, loaded as section 8 says. An `edit` or `create` file draws the
  Edit and Create forms, `lib-document-layout-form` in the same library, loaded as section 8 says
  too, through the design system's metadata editor:
  - **its cards are the form's sections,** under their headings, or its tabs are tabs. The form
    has one level of headings, so in a tab the cards' fields follow one another, and a card's
    heading there is not drawn;
  - **it draws only the fields the file lists.** The Dublin Core fields a version 1 form puts
    first are not added, so a file that wants a title lists `dc:title`;
  - **each field's input is the one its property's type picks,** as in version 1, with what its
    widget adds: a `vocabulary`'s `directory`, a `long-text`'s `rows`, a text area for `long-text`
    and `rich-text`, and a `currency`'s code beside the label. A field whose widget does not show
    its property's type is left out, as on the record page;
  - **`required` and `readOnlyWhen`** make a field required, or read-only, while their rule
    passes; `"required": true` makes it required whenever it is editable. A rule reads the values being entered over the record's,
    so a field shown, required or read-only by another field's value follows it as it is typed or
    chosen. In a create form the record is the one being created, in its folder;
  - **a read-only field** shows the value the record holds, through its widget as the record page
    shows it, and is not sent. One that turns read-only while the form is open goes back to that
    value. It is never required, and its checks are not run: there is nothing to correct;
  - **a field hidden by its rule** is not sent, and starts from the record's value again when it
    shows;
  - **a computed field** shows its result read-only, worked out from the values being entered;
  - **a failed check stops the save,** with its `label` or `labelKey` beside the field, or else a
    message naming the field and its bound: "Allowed amount cannot be more than Billed amount."
    `core.notBefore` compares days, read as the computations read dates, so an end on the start's
    day passes; `core.atMost` compares numbers. A check passes when either value is empty, which is
    `required`'s to refuse. One that cannot compare its values, a date against a text, does not
    stop the save, and the console says why: a check is a help, and the server still decides;
  - **the server's messages** go on the fields they name, as in version 1;
  - **a field the form cannot answer is left out:** a rule this build does not register, in
    `visibleWhen`, `required`, `readOnlyWhen` or a computation a check compares with, as on the
    record page, so that a field is never required, or editable, by accident.
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
  - **a row action's rules answer for the row, not the page's record.** A row action whose rule
    or `enabledRule` names a rule that answers from the state the page publishes about its own
    record, such as `app.rules.isLocked` or `app.rules.isNotBusy`, itself or inside `core.every`,
    `core.some` or `core.not`, is not offered: nothing publishes that state for a row. Those are
    the surface rules but `app.rules.isNote`, which reads the document, refused by ID. A row's rules see none of
    the page's flags, so a customer's own rule that reads them finds none;
  - **a record with a file or a note**, such as a File, a Picture, a Video or a Note, or any
    record a facet gives the `file` or `note` schema, keeps its own View tab, its preview or its
    editor: a record page beside a preview comes later;
  - **a computed column** of a table is not drawn yet, nor **a table inside a table's column**:
    that column is left out, and the rest of the table shows;
  - **`image`, `file-list` and `document-link`** show the property's own value, a file's name or
    the stored id, until each has its lookup. Section 12 proposes how `document-link` reads the
    linked record, and shows another of its properties;
  - **a rule nested more than 32 levels deep** leaves its tab, card, field or row action out: the rule
    registry answers no deeper, and past that it passes any rule not declared security-relevant,
    whatever the rule says;
  - **a form's inputs are its properties' types':** `rich-text` is edited as its HTML, in a text
    area; `user`, `group` and `document-link` as the stored id; `status-badge` as a text field, not
    a select; `address` and `table` with every subfield, not only the parts or columns the file
    names; `image` and `file-list` read-only, as version 1 shows a file. The console says so for
    each such field. The rich text editor, the pickers, the select and the uploads come later;
  - **`metadata` files of version 2** are still refused, and the generated panel shows.

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

## 12. Proposed: a property of a linked record

**Proposed, 23 November 2026, for review. Not built:** the validator refuses the example below,
and the app draws none of it.

**Why.** The Web UI Member page that section 9 rebuilds lists each claim's provider and the
provider's NPI ([the plan's section 3](plan.md#3-the-member-page-side-by-side)); section 9's example
leaves both columns out. A claim holds only its provider's id, in a reference such as
`claim:provider` (a `documentResolver` property). Version 2 shows the open or listed record's own
properties, so no column can show the provider's NPI. The plan names that column; until now,
nothing here said how to write it.

### The proposal

`document-link` takes one more parameter, `show`: a property of the linked record,
`"<prefix>:<name>"`, which the widget shows in place of the record's title. Without `show`, the
widget shows the linked record's title once its lookup is built (section 11); today it shows the
stored id.

```json proposed document-link.show
{
  "id": "claims",
  "labelKey": "payers.member.claims",
  "related": {
    "pageProvider": "member_claims",
    "parameters": [{ "field": "ecm:uuid" }],
    "columns": [
      "claim:number",
      { "field": "claim:billedAmount", "widget": "currency", "parameters": { "currency": "USD" } },
      {
        "id": "provider",
        "field": "claim:provider",
        "widget": "document-link",
        "parameters": { "types": ["Provider"] }
      },
      {
        "id": "providerNpi",
        "field": "claim:provider",
        "widget": "document-link",
        "labelKey": "payers.provider.npi",
        "parameters": { "types": ["Provider"], "show": "provider:npi" }
      },
      { "field": "claim:serviceDate", "widget": "date" },
      "claim:status"
    ],
    "sort": [{ "field": "claim:serviceDate", "order": "desc" }]
  }
}
```

- **One reference, several columns:** the provider's name and its NPI above are two columns over
  `claim:provider`. A list shows a property once today (section 11), because it keys its columns by
  property, so a column with `show` is keyed by both, the reference and the shown property, and
  the two stand side by side.
- **The value is shown by its schema type,** as a field with no widget shows its property, and
  links to the linked record. It has no widget of its own: an amount on the linked record shows as
  a number, not in a currency. A widget for the shown value is left for later, if a kit needs one.
- **Its label** is the shown property's, `layout.field.provider:npi`, then its name, unless the
  entry has its own `label` or `labelKey`. Without that, both columns above would read "Provider".
- **In `view` and `metadata` modes,** wherever a record is shown. In `edit` and `create`, a form's
  document picker chooses a record by its title, so `show` there is a `parameter` finding: the
  package is refused when it is built, and the app leaves the field out when it loads the file, as
  the validator treats every `parameter` finding.
- **One link away only.** `show` names a property of the linked record, never of a record that one
  links to in turn. A `show` that names a reference would show that reference's stored id, so
  wherever the content model is known it is refused.
- **Not in a `table` widget's columns:** a reference inside a complex value is not part of this
  proposal.
- **A list of references** (`string[]`) would show one value per linked record. Not measured.

### How the app reads it

Measured on Nuxeo 2025.10.18 on 23 November 2026, with the Payers kit's stand-in model
([`business-apps/packages/payers-claims-demo`](../../business-apps/packages/payers-claims-demo/README.md)),
where `claim:provider` is a document reference:

- **On a page provider's results**, the headers `fetch-document: claim:provider`,
  `depth: children` and `properties: claim,provider` return each claim with its provider inline,
  NPI included. `member_claims` for one member returned three claims, each with the six properties
  of its provider's `provider` schema, in one response of about 6 KB.
- **On the open record**, `fetch-document: lock,claim:provider,claim:member` with
  `depth: children` returned both linked records with their properties.
- **`depth: children` is what brings the properties,** on the open record as on the list. Without
  it, the linked record comes back with its title and no properties. The record page's read sends
  no `depth` today, so it would add one.

So the record page adds the reference of each `show`, and `depth: children`, to its read of the
open record, and a related list (`RecordListComponent`, through `PageProviderService`, section 11)
adds them to its page request; `properties` names the schemas of the shown properties as well as
the record's own. That request also asks for the `permissions` enricher, and whether Nuxeo then
runs it on each linked record too, and at what cost, is to measure. The linked records come in the same response,
not one request per row, and Nuxeo's own `fetch-document` does the work: no enricher of ours is
needed. A shown value that needs a label, such as a vocabulary entry, is looked up as one on the
record itself is: one request per distinct value.

### What the validator would check

- **Today** it refuses `show`: `the widget "document-link" has no parameter "show" [parameter]`.
  Its test holds the example above to exactly that refusal, so it fails, and asks for this section
  to be settled, on the day the parameter is built.
- **Proposed:** `show` is `"<prefix>:<name>"`, neither `ecm:` nor `var:`, and a `parameter`
  finding in `edit` and `create` modes. A `sort` entry naming a field that a column shows through
  `show` is refused, since it would order the records by a stored id. A plain `document-link`
  column is not affected.
- **Where the content model is known** (the pipeline in dev mode, the designer and the migration
  server, through phase 1's model reader): the field must be a document reference, and `show` a
  property of every type its `types` lists, and not a reference. Without `types` there is no type
  to check `show` against.
- **The app, when it loads the page,** checks every field against its type's schemas (section 11),
  but cannot check this one as fully: the field types it reads carry no resolver, so it cannot tell
  a reference from a string. To show the value by its schema type, it reads the schema of each
  type `types` lists, as it reads the open record's; without `types`, the value is shown as text.
- **A linked record that lacks the property** shows no value, and says "Not available" to a screen
  reader, as an unreadable one does.

### What the reader may see

**To measure before this is built.** Two things are not checked: that the server fetches the linked
record as the reader, with the reader's permissions, and what it sends for one the reader may not
read. There are two possibilities for the second, and the proposal holds only for the first:

- **The reference carries its stored id**, as when nothing is fetched. The widget then shows no
  value, and says "Not available" to a screen reader, never the id.
- **The whole request fails.** Then one unreadable provider would empty the member's claims list,
  and the lists engine could not ask for `fetch-document` on a list.

If the server fetched the linked record with more than the reader's permissions, `show` would show
what the reader may not read, and the proposal would have to fetch it another way.

### Sorting

A column showing a linked record's property cannot be sorted by it, and its header does not offer
to: a related list's headers sort on the server (section 11), and a page provider sorts its own
records' properties. So of the Claims table's columns, which the plan calls sortable, the
provider's name and NPI are the ones that cannot be.

### What the Studio migration would write

A Web UI column that shows a property of a referenced document, in a list whose
`nuxeo-page-provider` element asks for `fetch-document`, becomes a `document-link` column with
`show`. The converter of M1 does not write it yet.

### The other options, and why not

| Option                                         | What it would be                                        | Why not                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A path in `field`                              | `{ "field": "claim:provider/provider:npi" }`            | Nuxeo already writes a complex value's subfield with `/` (`member:address/city`), so one path would mean two things. Every reader of a field, its widget, rules, checks and sort, would need paths |
| A computation over the linked record           | A `core.linked` computation that reads it               | A computation works on the record already loaded and makes no request (section 4), so the linked record would have to be fetched anyway. And its result is not a link to the linked record         |
| A copy in the model                            | The model keeps `provider:npi` on each claim as well    | No platform change, and a kit may do it today. But the copy goes stale when the provider changes, unless a listener keeps it, which is server code in every kit                                    |
| An enricher of our own in `nuxeo-agentic-core` | A server call that adds the linked records to each list | Nuxeo's `fetch-document` already does it, in the same request                                                                                                                                      |

### Recommendation

Adopt `show` on `document-link`, and build it with the `document-link` lookup that section 11 lists
as missing. Both read the same inlined record: the lookup shows its title, `show` another of its
properties, so building one builds most of the other. Before building either, measure what the
server sends for a linked record the reader may not read. Its name, `show`, is open to review.
