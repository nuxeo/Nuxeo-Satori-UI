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
  - a checklist of the items a record must have done, from configuration;
  - banners above the cards, each shown by a rule, such as a picture's rights ending;
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

| Key          | Meaning                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `version`    | Required: `2`                                                                                  |
| `columns`    | How many columns the cards fill, 1 to 3. Default 1. `view` mode only                           |
| `banners`    | Messages above the cards, each shown while its rule passes (below). `view` mode only           |
| `review`     | A picture's review: pins on the picture, in rounds (below). `view` mode only                   |
| `shareLinks` | A picture's share links for people outside, with their downloads (below). `view` mode only     |
| `cards`      | The cards, in order                                                                            |
| `tabs`       | Or tabs, each holding cards: `{ "id", "label"?, "labelKey"?, "visibleWhen"?, "cards": [...] }` |
| `$schema`    | Optional: the address of a JSON Schema, for editors, as version 1's fragments write it         |

A file has `cards` or `tabs`, never both.

### Banners

A banner says something about the record that the reader should see before its cards, such as a
picture whose rights are ending. It shows above the cards, or above the tabs, while its rule passes:

```json
{
  "version": 2,
  "columns": 2,
  "banners": [
    {
      "id": "rights-ended",
      "tone": "negative",
      "labelKey": "acme.asset.rightsEnded",
      "visibleWhen": { "type": "app.rules.datePassed", "parameters": [{ "field": "dc:expired" }] }
    },
    {
      "id": "rights-ending",
      "tone": "warning",
      "labelKey": "acme.asset.rightsEnding",
      "visibleWhen": {
        "type": "app.rules.dateWithin",
        "parameters": [{ "field": "dc:expired" }, 30]
      }
    }
  ],
  "cards": [
    {
      "id": "rights",
      "labelKey": "acme.asset.rights",
      "fields": [{ "field": "dc:expired", "widget": "date" }, "dc:rights"]
    }
  ]
}
```

| Key                 | Meaning                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                | Required, unique in the file, as a card's: banners and cards share the file's ids              |
| `label`, `labelKey` | The message, as a literal or a translation key. One of them is required                        |
| `tone`              | `info`, `warning` or `negative`: the words a `status-badge` uses for its tones. Default `info` |
| `visibleWhen`       | A rule (section 5). The banner shows only while it passes; without one, it always shows        |

- **The message is text,** as a card's heading is. It names no property, so a date the reader needs
  is shown by a field: the `rights` card above shows the day the rights end.
- **Each banner is decided alone.** The two above never show together, because their rules never
  pass together: a date that has passed is not within the next 30 days.
- **A banner is not a security control,** any more than a hidden field is. Refusing a download
  whose rights have ended is the server's to do.

### Review

A record page that shows a picture can show it as a creative review: a reviewer places a pin at a
point of the picture and writes a note, the pins are listed beside it, and the review goes in
rounds. `{}` turns it on; it takes no option yet:

```json
{
  "version": 2,
  "review": {},
  "cards": [{ "id": "asset", "labelKey": "acme.asset.card", "fields": ["dc:title"] }]
}
```

- **Only on a picture.** The page draws the review in place of the picture's views (section 11),
  for a record with the `picture` schema and not the `video` one. On any other record the review is
  left out, and the console says so; given the content model, the pipeline refuses a review for a
  type without the `picture` schema, or with the `video` one. A facet given to one record at run
  time can add the `picture` schema to a type the model has without it: the page then draws the
  review, which the pipeline refused for the type.
- **Pins.** A pin is placed by clicking the picture, or with "Add a pin" and its form's two fields,
  how far across and how far down in percent, which the keyboard alone fills; the pin being placed
  shows on the picture as they change, and its note is required. Both are offered only while a view
  of the picture is shown. Each pin is numbered in the order the pins were written, and listed
  beside the picture with its note, its author and its place. Choosing one, on the picture or in
  the list, highlights it in both; choosing it again chooses none.
- **Where a pin is** is written as fractions of the view's width and height, from its top left, so
  it stays on its point on a view of another size: Nuxeo makes each view at the picture's
  proportions. A pin does not say which file it was placed on: replace the picture, and every pin
  shows on the new one.
- **In the order the repository wrote them.** The review reads its annotations oldest first by
  `dc:created`, which the repository stamps when each is written. Not by an annotation's own
  `creationDate`, which Nuxeo 2025 takes from the request when one is sent, so a writer could
  backdate one. A holder of `Write` on the record, which its annotations inherit, can still change
  `dc:created` afterwards, as they can change the record.
- **Rounds.** A pin is in the round open when it was written, round 1 first, whatever its page had
  seen: a pin written on a page that had not yet seen round 1 closed is round 2's. "Close round"
  closes the round open then and opens the next; the pins of a closed round stay on the picture and
  in the list, marked as past. Each close moves the rounds by one: a second close of a round
  already closed, by two people at once, changes nothing, and a close deleted from the record's
  comments renumbers the rounds after it, merging none. A review counts 999 rounds at most. After
  each write the page reads the record's annotations again, so that what others wrote meanwhile
  shows.
- **Stored as Nuxeo's own annotations,** with no schema and no add-on: a pin is an annotation whose
  `entity` holds its round and place, written through the `@annotation` REST adapter, and a
  round's close is an annotation too, on the same record. Their file is `picture:views`, not
  `file:content`, where the Annotations tab's viewer keeps its own. An annotation is a comment that
  names a file, so each pin's note is also one of the record's comments, which the Comments panel
  lists, and where Nuxeo lets its author, or an administrator, edit or delete it as any comment.
  Editing its text there keeps its place and round ([api-integrations.md](../api-integrations.md),
  section 39).
- **What the page offers,** from the record's `permissions` enricher, which the document page
  asks for: Add a pin to a holder of Nuxeo's `Comment` permission, or of `Write`, on the record;
  Close round to a holder of `Write`, once the open round has a pin. Nothing on a version, a record
  in the trash, a page drawn read-only, as the layout designer's preview is, or a record that came
  without its permissions. A reader sees the pins and their notes, and is offered neither.
- **Hiding a control is not the security control.** Nuxeo 2025's comment service accepts an
  annotation, a pin or a round's close, from anyone who may read the record, through the REST API,
  whatever the page offers: `TreeCommentManager.checkCreateCommentPermissions` checks `Read`. It
  makes the signed-in user the author, whatever the request says. A review that only some readers
  may write needs the server to check more, which nothing here does.
- **By keyboard,** the pins on the picture are one stop, a toolbar: the arrow keys, Home and End
  move among them and choose the one reached, which a hidden hint says. Each one's name says its
  number, its round, whether that round is past, its place in percent and its note.

### Share links

A record page that shows a picture can list its share links: addresses a person outside the
company opens without signing in, each serving some of the picture's views, or its original, until
a last day. `{}` turns them on; they take no option yet:

```json
{
  "version": 2,
  "review": {},
  "shareLinks": {},
  "cards": [{ "id": "asset", "labelKey": "acme.asset.card", "fields": ["dc:title"] }]
}
```

- **Only on a picture,** as the review: drawn under the picture, above the cards, for a record with
  the `picture` schema and not the `video` one. On any other record they are left out, and the
  console says so; given the content model, the pipeline refuses them for a type without the
  `picture` schema, or with the `video` one.
- **The server holds every rule,** through `nuxeo-agentic-assets`
  ([its README](../../nuxeo-agentic-assets/README.md)) and its Automation operations
  `ShareLink.Create`, `ShareLink.List`, `ShareLink.Revoke` and `ShareLink.Downloads`
  ([api-integrations.md](../api-integrations.md), section 40): who may manage a picture's links,
  `WriteSecurity` on it; what a link may list; and that it serves its items watermarked, and only
  while it is neither revoked nor past its last day and while the asset's rights allow each one.
- **Drawn only for those the server lets manage them.** The page asks for the links, checking no
  permission first, and on a 403 draws nothing of them: no heading, no frame. Any other failure is
  said, with Retry. Hiding the section is not the control: the server refuses the same user's every
  call.
- **A new link** lists the original, when the record has one in `file:content`, or some of its
  views, each by its title: a view with no title of its own is not offered. Its last day is a day in
  UTC, from today to 90 days on, as the asset's rights end is. The server refuses an item the
  asset's rights do not allow now, creating nothing, and the page says which and why, in the words
  of the rights' reasons.
- **Its address is shown once,** with Copy, made of this page's origin and the path the server
  answers, and never one on another origin. The page holds it until Done, or another record, and
  stores, logs and announces nothing of its token: the server keeps only the token's hash, so a
  lost address is revoked and made again.
- **Each link is listed** by its label, the first 8 characters of its id, which the server's
  watermark also prints, with its state (active, expired or revoked), its items, its last day,
  who made it and when, and, once revoked, who revoked it and when. Revoke, after a confirmation,
  is offered on an active link.
- **The downloads log** lists each item a link served, newest first: when, through which link,
  and what, the latest 200 at most, and nothing about who opened it.
- **On a page drawn read-only,** as the layout designer's preview is, the links and the log are
  listed, with no new link and no Revoke.

### Cards

| Key                 | Meaning                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | Required, unique in the file: 1 to 64 letters, digits, `.`, `_` or `-`                                                                                                                                        |
| `label`, `labelKey` | Its heading, as a literal or a translation key, as in version 1. A key with no text, in the reader's language or the fallback one, shows the card's `id`, made readable; a card with neither shows no heading |
| `span`              | How many columns it takes, up to `columns`. Default 1                                                                                                                                                         |
| `visibleWhen`       | A rule (section 5). The card shows only while it passes                                                                                                                                                       |
| `fields`            | Its fields (below)                                                                                                                                                                                            |
| `related`           | Or a list of related records (section 7), in `view` mode only                                                                                                                                                 |
| `timeline`          | Or the record's history (section 7), in `view` mode only                                                                                                                                                      |
| `comments`          | Or the record's comments (section 7), in `view` mode only                                                                                                                                                     |
| `external`          | Or fields of a record in another system (section 7), in `view` mode only                                                                                                                                      |
| `checklist`         | Or the items a record must have done, each done or not, with who and when (section 7), in `view` mode only                                                                                                    |

A card has one of `fields`, `related`, `timeline`, `comments`, `external` and `checklist`.

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
known: by the app when it loads the page, by the pipeline when it has a model (one it is given,
or a stand-in package's own), and by the layout designer, which will not save the file. The migration server is to refuse it too (section 11).

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
  user, their name; for a `document-link`, the linked record's title.
- **A `document-link` shows the record it names,** by its title, as a link that opens it, and a
  list of them one after another. A record the reader may not read, or that no longer exists,
  shows "Unavailable", never its id and never an error. `types` is the picker's: the record page
  shows whatever record the id names (section 11).

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

Version 2 adds five rules to the 29 or so that exist:

| Rule                   | Parameters                                | True when                                                                  |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `app.rules.fieldIn`    | A property, then the values               | The property's value is one of the values; for a list, any of its items is |
| `app.rules.inState`    | The lifecycle states                      | The record's lifecycle state is one of them                                |
| `app.rules.inGroup`    | The groups                                | The user is in one of the groups                                           |
| `app.rules.datePassed` | A date                                    | The date is before today                                                   |
| `app.rules.dateWithin` | A date, then a number of days, 0 to 36500 | The date is today, or no more than that many days after it                 |

- **What a rule sees.** It is evaluated with the open record, the user and their groups. In a form
  it also sees the values being entered, so a field shown by another field's value appears as soon
  as that value is chosen.
- **A date** is a property, `{ "field": "dc:expired" }`, or a literal: a day, `"2026-12-01"`, or an
  ISO 8601 date and time with its zone. The validator refuses any other literal, a day that does
  not exist included. It is read as the `date` widget reads one (section 11): a stored day as
  written, and an instant on the reader's day. Today is the reader's day, from the page's clock:
  the browser's in the app, and one a test or a demo pins (section 11).
  A property with no date, or a value that is not one, passes neither date rule.
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

### Fields from another system

**Built on 24 November 2026, as the first slice of phase 7** ([development plan](development-plan.md)).
A card can show fields of a record that lives in another system, a system of record such as a core
claims system, in `view` mode. The server reads the record through a connector that a kit's
package contributes, by a key the open record holds, such as a claim's number
([`nuxeo-agentic-connectors`](../../nuxeo-agentic-connectors/README.md)):

```json
{
  "id": "payment",
  "labelKey": "payers.claim.payment",
  "external": {
    "connector": "payers.claimPayments",
    "fields": [
      {
        "name": "paymentStatus",
        "widget": "status-badge",
        "parameters": {
          "tones": { "Paid": "positive", "Pending": "warning", "Denied": "negative" }
        }
      },
      { "name": "paidAmount", "widget": "currency", "parameters": { "currency": "USD" } },
      { "name": "paidOn", "widget": "date" },
      "policyNumber"
    ]
  }
}
```

| Key         | Meaning                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connector` | Required: the id of a connector the server registers                                                                                               |
| `fields`    | Required: the connector's fields to show, in order, each its name or `{ "name", "label"?, "labelKey"?, "widget"?, "parameters"?, "visibleWhen"? }` |

- **The file names the connector and its fields, and nothing else.** The other system's address,
  the record's key, the credential and the fields the server may return are the connector's, in
  the server's configuration. A text anywhere in the card, or a key, that looks like an address is
  a structural error, and the file is refused: `//` or `\\` anywhere, a scheme at its start, a word
  and a colon with no space after it such as `https:` or `ldap:`, or a host with a port such as
  `core.internal:8443`. A property, `claim:currency`, is not one, nor is "Status: paid". This keeps
  layouts honest; it is not what guards the server, since only the connector's id leaves the
  browser, held to a name at both ends.
- **The server's allow-list decides what leaves it.** The connector returns only the fields it
  lists. A field the file names and the connector does not return shows nothing. Given the
  connectors a server registers, through `--registered`, the validator refuses such a field and an
  unknown connector. Without them, as when the app loads the file, a connector is the server's to
  define, as a page provider is, and its names are held to their form only: a connector's id, and
  field names of letters, digits and `_`, never a property's `<prefix>:<name>`.
- **Its widgets show one value as text:** `text`, `long-text`, `number`, `currency`, `percent`,
  `date`, `relative-date`, `boolean` and `status-badge`. Without one, a number shows as `number`
  shows it, a boolean as `boolean`, and a text as it is. A widget that does not show the value the
  system answered, `date` given a number, leaves that field out, and the console says why.
- **The reader's permission comes first.** The server checks that the reader may read the open
  record, and holds the stronger permission the connector names if it names one, before it calls
  the other system, and reads the key from the record as stored. A record of a type the connector
  does not read, or with no key it can send, is answered "nothing to look up", and nothing is sent.
- **Its states:** loading; the fields; "nothing found" when the other system has no such record,
  or none of the fields has a value; "nothing to look up" when the record holds no key; and an
  error, with Retry for a server error, a timeout or an unreachable system.
- **Not a security control,** as nothing in a layout is. A field hidden by its rule is hidden from
  this page; the operation returns every allowed field to anyone who may read the record.

### A checklist

**Built on 25 November 2026, for phase 2's demo step 6** ([development plan](development-plan.md)):
an appeal case with its checklist and timeline. A card can show the items a record must have done,
each done or not, with who did it and when, in `view` mode:

```json
{
  "id": "checklist",
  "labelKey": "payers.appeal.checklist",
  "visibleWhen": {
    "type": "app.rules.fieldIn",
    "parameters": [{ "field": "case:category" }, "appeal"]
  },
  "checklist": {
    "field": "case:checklist",
    "items": [
      { "id": "medicalRecords", "labelKey": "payers.appeal.medicalRecords" },
      { "id": "reviewerAssigned", "labelKey": "payers.appeal.reviewerAssigned" },
      { "id": "decisionLetter", "label": "Decision letter sent" }
    ]
  }
}
```

| Key     | Meaning                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `field` | Required: the record's property that holds the items' state, `"<prefix>:<name>"`, never an `ecm:` or `var:` name                               |
| `items` | Required: the items, in order, at least one: `{ "id", "label"?, "labelKey"? }`, with a `label` or a `labelKey`, and an `id` unique in the card |

- **The file says what is required, and the record how far it has got.** The items, their order
  and their words are the file's, so every record of the type is held to the same list. The
  property holds one entry per item done or under way: a list of complex values with four
  subfields, `item`, the item's `id` as text; `done`, a boolean; `doneBy`, a user name; and
  `doneOn`, a date. A schema written for a checklist uses those names; given the content model,
  the validator refuses a property of another shape (section 11).
- **Each item shows done or not.** It is done when the record's first entry for it has `done`
  `true`. An item with no entry, or whose entry is not done, shows as not done, without anyone or
  any day, whatever the entry still holds. A done item shows who, as a `user` field shows a name,
  and when, as the `date` widget shows a day. Above the items, a count says how many are done.
- **An entry the file does not list is not shown.** A record's entry for an item the file has
  dropped stays on the record, and the page says nothing of it.
- **The card ticks nothing.** It is read-only: an item's state is the record's, changed wherever
  the record is, by the Edit form, a workflow's chain or an import. Who and when are what the
  entry holds, written by whoever wrote it; nothing here stamps them.
- **Not a security control,** as nothing in a layout is. The server's permissions decide who may
  change the property, and so tick an item.

## 8. What is refused, and when

| When                                     | A structural error                                                   | An ID the platform does not have                                                          |
| ---------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| When the package is built (the pipeline) | The package is refused, naming the file and the place                | The package is refused, naming the file, the place and the ID                             |
| When the app loads the file              | The file is refused, and the generated layout shows, as in version 1 | That banner, card, field, list column or row action is left out, and the console says why |

- **In a list of related records,** a finding about one column or one row action leaves out that
  one. A finding about the list itself, such as a key version 2 does not have, leaves out its card,
  and so does one about a timeline, comments or a checklist. In a card from another system, a
  finding about one field leaves out that field, and one about the card's own keys leaves out the
  card.
- **A finding about a banner,** such as a rule this build does not register, leaves out that
  banner, and **one about the review,** such as an option this build does not have, leaves out the
  review: the picture shows its views alone. One about the share links leaves out the share
  links alone.
- **Strict when built.** A package that reaches a server has already passed every check, so the
  app has little to refuse.
- **Tolerant when loaded.** A file written for a later platform still shows everything this one
  knows.

What counts as structural:

- not version 2;
- `cards` and `tabs` together;
- an `id` that is missing, malformed or used twice;
- a card with more than one of `fields`, `related`, `timeline`, `comments`, `external` and
  `checklist`, or none;
- a card from another system with no connector, no field, a name that is not one, or a text that
  looks like an address;
- a checklist with no property, a property that is not one or is an `ecm:` or `var:` name, no
  item, or an item that is not an object, has no `label` or `labelKey`, or whose `id` is missing,
  malformed or listed twice;
- a banner with no `label` or `labelKey`, or a `tone` other than its three;
- a field with both `field` and `computed`, or neither;
- a computed field with no `id`;
- form-only keys in `view` mode, or `banners`, `review`, `shareLinks`, `related`, `timeline`,
  `comments`, `external` or `checklist` outside it;
- a `review` or a `shareLinks` that is not an object;
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
| A layout block a layout uses              | A card of its fields where it sits, with its condition's rule    |
| A tab of the document page                | A tab of each type's view file it shows on, holding its block    |
| A workflow task layout                    | A task form, `tasks/<workflow>.<step>.layout.json`               |

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
  - **a task form**, a layout file for one workflow step, is drawn the same way in the task panel,
    over the record the task is on, its `var:` fields bound to the task's variables
    ([app-definition-v2.md, section 6](app-definition-v2.md#6-task-forms));
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
  - a row offers the row actions the file lists, while their rules pass for that row. The
    platform's five, `app.rowActions.download`, `.rename`, `.copyTo`, `.moveTo` and `.delete`, are
    registered once for the whole app, so a record page offers them as browse does, with the same
    dialogs; a customer's own, registered in Layer 2 code, is offered too
    ([extension reference](../extension-reference.md), section 10a);
  - after one of the platform's row actions renames, copies, moves or deletes a record, every
    list on the page reads its page again, keeping its page and its order. A customer's own row
    action does the same when its handler calls `DocumentChangesService.notify()`.
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
    is, too; another kind chosen in the filter is not. An audit slower than 2.5 seconds still
    lacks the change, until the record next reloads.
- **The document page keeps the record page while it reloads the record** with the reader on the
  View tab: after an edit, a transition, a check-in, a restore from the trash or a change to its
  attachments. A lock does not reload it, and restoring a version opens the live record instead,
  drawn anew. The page shows no spinner, and hands the record page the reloaded record in place,
  so the record page and its cards stay: the timeline is refreshed in place, with the kind chosen
  in its filter, and a comment half written in a comments card is kept.
  - while the layout is resolved again for the reloaded record, the one already resolved for that
    record stays, compared by `uid`. Another record, even of the same type, shows no record page
    until its own layout is resolved;
  - between the save and the reload, the page shows the record with the edited values and the
    permissions, favourite, transitions and lock it had, since the save's answer carries none of
    them. After a transition, until the reload answers, the toolbar still offers the transitions
    of the state the record left;
  - a reload from another tab, a View tab that a `documentView` entry takes, and the packaged view
    still give way to the spinner and are drawn anew;
  - the rest of the page stays too. The History tab reads the audit when it is drawn, and is put
    away on such a reload, so that it reads the reloaded record's history when it is next opened.
    A tab that a customer's code contributes is not drawn anew by it either.
- **A `document-link`** shows each record its value names by the record's title, as a link that
  opens it, on the record page and in every cell of a list, a related card's or a queue's.
  `LinkedRecordLookup`, in the same library, reads them:
  - **one search for a page or a list,** never one per field or cell: the record page asks once
    for every record its fields name, and a list once for every record its page of rows names, each
    id once. A set whose ids are all read asks for nothing, so a record reloaded with the same
    links, another order of the same rows, or a page shown before asks nothing again. The record
    page keeps what it and its lists read for as long as it is drawn, not for the session: its lists
    share its lookup, so a record a field and a list both name is asked for once, and a list in a
    tab drawn again asks nothing again. A queue's list keeps its own, for as long as it is drawn.
    The records and the labels are asked for apart: a change to the records a page names reads no
    label again, and a change to its labels asks for no record again. One search asks for 100 ids
    at most, and more ids are asked for in as many searches;
  - **the search runs through the REST API as the reader,**
    `SELECT * FROM Document WHERE ecm:uuid IN (?, …)` with one placeholder per id, each id sent as a
    `queryParams` value of its own, which Nuxeo quotes as a literal before the query runs. An id is
    never written into the query's text, so no value can change what it means. Only a value that
    is a document's id as Nuxeo writes `ecm:uuid`, a UUID in lower case, is sent at all. Measured on
    Nuxeo 2025.10.18: two members asked this way are both returned, and a value written to close the
    literal, `x' OR ecm:uuid IS NOT NULL OR ecm:uuid = 'y`, is answered HTTP 200 with no record, the
    value read as one quoted id that names none;
  - **a record the reader may not read, or that no longer exists, is not returned,** and shows
    "Unavailable": neutral text in the reader's language, never the stored id and never an error.
    So does a value that is not a document's id, such as a path or an id written with its
    repository's name, which is never asked for, and a record whose search failed, which the
    console reports and the next set of ids naming it asks for again. Nuxeo's search applies the
    reader's own permissions; the checks here ran as an administrator, who may read every record,
    so "may not read" was not seen live, only "no longer exists";
  - **a record in the trash is shown,** as a link, like any other the reader may read, as Nuxeo's
    document resolver reads a reference: the search names no `ecm:isTrashed`, and returned a record
    of the check's own moved to the trash. It leaves out no version or proxy either, which was not
    measured;
  - **the link opens the record through the app's router,** as a row does: the document page for a
    record, browse for a folder and the collection page for a collection, with the route built from
    what the search returned, never from the stored value. In a list's cell it is reached from its
    row with the arrow keys, as a row's other controls are, and opens the record it names, not the
    row's;
  - **while a record is read its field shows nothing,** not its id: the title replaces it when the
    search answers;
  - **elsewhere it shows the title as text:** in a table's cell, which is one line of text, and the
    console says so; in a template's placeholder, `{case:member}`, through the field that shows the
    property; and in a form's read-only field. A form's input still edits the stored id (the limits
    below).
- **The Properties panel shows a reference by the record it names, too:** version 1's panel,
  generated from the schemas or drawn from a `metadata` file, beside the record page or any
  document page. It has no widgets, so a reference is a property whose schema binds it with a
  `documentResolver` that stores an id, `store` `id` or `idOnly`, as `/config/types/<type>` reports
  it; `case:member` is one. Its value, alone, in a list or inside a complex value, shows the
  record's title as a link that opens it, through the same lookup and with the same rules as
  above: one search for every record the panel names, each id once, only lower-case UUIDs sent,
  "Unavailable" for a record the reader may not read, one that no longer exists or a value that is
  not an id, and nothing while the record is read. The panel keeps its own lookup for as long as
  it is drawn, so a record the record page beside it names is asked for once by each: a Case page
  sends two searches for its member and its claim (measured). A resolver that stores a path,
  `path` or `pathOnly`, holds no id, and its value shows as stored. `store` `id` accepts a bare id,
  as the Payers kit's seed writes one, but Nuxeo's resolver itself writes `<repository>:<id>` for
  it, and such a value is not an id the lookup asks for: it shows "Unavailable" here, as in a
  `document-link` on the record page. On the record page, a field with no widget still shows a
  reference's stored id: naming the `document-link` widget is what shows its title there.
- **A card of comments** draws the platform's `nxs-comments`, the thread the Comments panel beside
  the page shows, with the card's `pageSize`.
- **A card from another system** draws `RecordExternalComponent`, in the same library:
  - it asks the server once, through `ConnectorRecordService`, with the Automation operation
    `Connector.Read`, the open record as its input and the connector's id as its one parameter;
  - it shows, in the file's order, the fields whose rules pass for the open record and the user and
    that the answer gives a value, each through its widget as one line of text, or a tag for a
    `status-badge`; the rest of the answer is not drawn, and the server has already left out
    whatever the connector's allow-list does not name;
  - it asks again when it is given another record, the same record with another modification date,
    since an edit may change the key, or another connector, and on Retry;
  - an answer not of the operation's shape is an error, and a value in it that is not a text, a
    number or a boolean is dropped. Not checked on a server: the operation is proven by the add-on's
    own tests, against a stub of the other system, and nothing is installed yet.
- **A checklist's card** is drawn by the record page itself, from `record-checklist.ts` in the same
  library:
  - it reads the open record's property, already loaded, and asks the server for nothing of its
    own: the names of the people who did the items done are read with the page's other users, as a
    `user` field's are, and show as stored until they are;
  - its property is held to the type's schemas when the page loads, as a field is. One that neither
    the type nor the record's facets have, or that is not a list of complex values with the four
    subfields, each of its type, leaves the card out, and the console says why; one whose schema
    lists no subfields is taken as written, as a table's is;
  - above the items, "2 of 5 done"; then each item, in the file's order, with an icon, its words,
    "Done" or "Not done", and, for one done, who and the day. The icon is decorative: the words
    say the same;
  - it draws the same on a read-only page, the designer's preview, since it ticks nothing anyway.
    Not seen on a server yet: the Payers kit's appeals, its first user, are not installed.
- **The date rules read the page's clock**, `RECORD_PAGE_TODAY` and `RECORD_PAGE_TIME_ZONE` in
  `record-clock.ts`, as its computations and dates do: on the record page, its banners, cards,
  tabs, fields and a related list's columns, and in a version 2 form, its fields' rules. The page
  gives them to the rules as the rule context's `today` and `timeZone`, so a banner on a date reads
  the day the date field beside it shows, and a test or a host that pins the page's day pins its
  banners too. In the app both tokens are the browser's: its clock, and the reader's zone. A zone
  given to `RECORD_PAGE_TIME_ZONE` is an offset, such as `+0530`: the `date` widget formats with
  Angular, which reads no IANA zone, so one would reach the rules and not the fields beside them.
  Elsewhere, in a queue's or a home card's rule and in a row action's, the date rules read the
  browser's clock, as the rest of the rules' library does. A zone the browser cannot read passes
  neither date rule.
- **Banners** are drawn above everything else on the page, the picture and the tabs included, one
  under the other in the file's order, each while its rule passes for the open record and the user,
  through the component ID `nxs.primitives.banner`, so that an override of the ID reaches them
  ([extension reference](../extension-reference.md), section 6a). `info` and `warning` are its tones
  of those names, and `negative` is its `error`. A banner is met in place, so a screen reader does
  not announce it as it appears. Its message is its `label`, else the text of its `labelKey`, else
  its id made readable, as a card's heading is.
- **A Picture's record page shows its picture first.** A record with the `picture` schema, a
  Picture or any record a facet gives it, has its record page though it holds a file, and the page
  shows its picture views above the cards, under the banners, as Nuxeo lists them in
  `picture:views`, or, when the file has a `review` (section 2), the same views as a review, with
  its pins and rounds beside them (`RecordPictureReviewComponent`). That is
  `RecordPictureViewsComponent`, in the same library:
  - one view shows large: `Medium` first, else `Small`, `FullHD` or `OriginalJpeg`, else the first,
    so that a view sized for a screen loads first where the record has one. A button for each view shows its name and size,
    and shows that view instead; the caption names the view shown, its size and its format;
  - **each view is fetched as a file, through the application,** with
    `DocumentDetailService.fetchBlobByXpath` and `picture:views/<n>/content`, which sends the
    application's authentication, and shown from a blob URL. No `<img>` is given a Nuxeo address
    ([AGENTS/07-security.md](../../AGENTS/07-security.md)). It is fetched with the reason `view`, as
    the document page's preview is, so that Nuxeo audits it as a view;
  - a view is fetched when it is first shown, and a view shown before is shown again from its blob
    URL. A record reloaded with the same views, as after an edit, asks for nothing; a picture
    replaced on the record has new files, which are fetched, and the blob URLs of the old ones are
    revoked at once, as are another record's. All of them are revoked when the page is left;
  - a view that cannot be fetched shows the error state, with Retry for a server error; a picture
    whose views Nuxeo has not made yet, as just after an upload, says so. For a record with the
    `Picture` facet, which Nuxeo makes views for, a Picture or a kit's own type that extends
    Picture, the document page asks the server again, up to six times half a second apart, and the
    page shows the views when it is given the record. A record that has the `picture` schema
    without the facet is not asked again, since Nuxeo makes it no views, and nor is any once those
    six have passed: it shows the views when it is next opened;
  - the record's own file is not shown, nor the picture's information, EXIF and IPTC that the
    document page's viewer lists: a field shows a property a kit wants, such as `dc:rights`;
  - **the document page does not download the record's own file,** the original, while the record
    page holds the View tab: it is held back until something on the page shows it, the Annotations
    tab, whose viewer does, or the packaged viewer, when the type turns out to have no record page.
    A record with the `picture:views` property and none of the `video` schema's is held back so,
    until its type's layout is read.
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
  - **a row action needs a handler.** One the file lists that nothing registers is not offered;
  - **a row action's rules answer for the row, not the page's record.** A row action whose rule
    or `enabledRule` names a rule that answers from the state the page publishes about its own
    record, such as `app.rules.isLocked` or `app.rules.isNotBusy`, itself or inside `core.every`,
    `core.some` or `core.not`, is not offered: nothing publishes that state for a row. Those are
    the surface rules but `app.rules.isNote`, which reads the document, refused by ID. A row's rules see none of
    the page's flags, so a customer's own rule that reads them finds none;
  - **a record with a file or a note but no picture**, such as a File or a Note, or any record a
    facet gives the `file` or `note` schema and not the `picture` one, keeps its own View tab, its
    preview or its editor: a record page beside its preview comes later. So does **a video**: Nuxeo's
    `Video` facet declares the `picture` schema as well as `video`, for its still frames, so a
    record with the `video` schema keeps its player, whatever else it has;
  - **a computed column** of a table is not drawn yet, nor **a table inside a table's column**:
    that column is left out, and the rest of the table shows;
  - **`image` and `file-list`** show the property's own value, a file's name, until each has its
    lookup. Section 12 proposes how a `document-link` would show another of the linked record's
    properties than its title;
  - **a rule nested more than 32 levels deep** leaves its tab, card, field or row action out: the rule
    registry answers no deeper, and past that it passes any rule not declared security-relevant,
    whatever the rule says;
  - **a form's inputs are its properties' types':** `rich-text` is edited as its HTML, in a text
    area; `user`, `group` and `document-link` as the stored id; `status-badge` as a text field, not
    a select; `address` and `table` with every subfield, not only the parts or columns the file
    names; `image` and `file-list` read-only, as version 1 shows a file. The console says so for
    each such field. The rich text editor, the pickers, the select and the uploads come later;
  - **`metadata` files of version 2** are still refused, and the generated panel shows.

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
  widget that does not show its property's type, a table column naming a subfield its property
  lacks, and a checklist whose property the type lacks, is not a list of complex values, or lacks
  one of `item`, `done`, `doneBy` and `doneOn` or has it of another type. Each is `unknown` or
  `parameter`, so loading stays tolerant. The pipeline holds a package to a model when it is given
  one, and a package that ships a stand-in model to its own `content-model.json`
  ([package-pipeline.md](package-pipeline.md), section 4), and the layout designer holds the file it edits, a record page or an edit or create form, to the server's
  model when it can read it, and saves none with a finding
  ([its README](../../libs/features/layout-designer/README.md)); the migration server
  is still to call it. Its limits:
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
widget shows the linked record's title, through the lookup section 11 describes.

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
  but cannot check this one as fully: the field types it reads say whether a `documentResolver`
  stores an id, which the Properties panel reads (section 11), and not which types it links to, so
  it could tell such a reference from a string but not check `show` against the linked type. To
  show the value by its schema type, it reads the schema of each type `types` lists, as it reads
  the open record's; without `types`, the value is shown as text.
- **A linked record that lacks the property** shows no value, and says "Not available" to a screen
  reader, as an unreadable one would under this proposal. The lookup that is built, section 11's,
  shows one the reader may not read as "Unavailable".

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

Adopt `show` on `document-link`. The `document-link` lookup it builds on is built (section 11), as a
search of its own, one per page or list, rather than from an inlined record, and a record the reader
may not read is absent from it. The lookup shows the linked record's title; `show` would show
another of its properties. Whether `show` reads it from that search, by naming its schema in
`properties`, or from `fetch-document` as above, is part of this review. Before building it, measure
what the server sends for a linked record the reader may not read. Its name, `show`, is open to
review. `show` is not built, and the validator still refuses it.
