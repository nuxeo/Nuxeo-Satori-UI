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

| Key                 | Meaning                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `id`                | Required, unique in the file: 1 to 64 letters, digits, `.`, `_` or `-` |
| `label`, `labelKey` | Its heading, as a literal or a translation key, as in version 1        |
| `span`              | How many columns it takes, up to `columns`. Default 1                  |
| `visibleWhen`       | A rule (section 5). The card shows only while it passes                |
| `fields`            | Its fields (below)                                                     |
| `related`           | Or a list of related records (section 7), in `view` mode only          |

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
known: by the pipeline in dev mode, by the designer, and by the migration server.

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

| When                                     | A structural error                                                   | An ID the platform does not have                              |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| When the package is built (the pipeline) | The package is refused, naming the file and the place                | The package is refused, naming the file, the place and the ID |
| When the app loads the file              | The file is refused, and the generated layout shows, as in version 1 | That card or field is left out, and the console says why      |

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

The converter of M1 writes version 2. The [migration document](studio-migration.md), section 3,
lists what each Web UI element becomes. In version 2's terms:

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
  ([package-pipeline.md](package-pipeline.md)); the Studio migration's converter will, in M1.
- **What the app draws so far.** A `view` file draws the record page, `RecordPageComponent` in
  `libs/shared/document-layouts`, loaded as section 8 says. Its limits, each said in the console
  when a file meets it:
  - **related records** are not drawn yet, so a card that lists them is left out;
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
