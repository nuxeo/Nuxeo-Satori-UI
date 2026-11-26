# Controlled documents (demo)

The controlled documents starter kit, for phase 8 of the
[development plan](../../../docs/business-apps/development-plan.md): an engineering register whose
numbers, revisions and supersession are the server's, and, since version 0.2.0, its transmittals and
review cycles, from [`nuxeo-agentic-documents`](../../../nuxeo-agentic-documents/README.md) 0.2.0,
which the package depends on. It shows demo steps 1 to 3, inside the server: an engineer issues a
transmittal, its recipient comments and returns it, and the new revision supersedes the old one.
Outside users, and the portal they would sign in to, are decision C's and not built: here a
transmittal goes to named people with an account on the server. Every name in it is fictional.

## The short version

- **A record page** for an engineering document: its number, revision and status first, then what
  it is, the other revisions of its number, its review cycles, and its history. On a superseded
  revision, a banner above the cards says so and links to the revision that superseded it, by its
  title.
- **Transmittals, since 0.2.0:** a Create form, in the transmittals register, that issues one; its
  record page, with the documents as issued and each recipient's answer; and each recipient's
  receipt, with an Edit form to acknowledge it, or return it with a comment.
- **Review cycles, since 0.2.0:** a document's review-cycle card, which lists them; and a cycle's
  page, with its threads and whether each is resolved, Nuxeo's own comments, and an Edit form whose
  one field closes it. The server keeps a cycle with an open thread from closing.
- **Queues:** each number's current revision, by number; the transmittals awaiting the person
  signed in, the nearest due first; and every transmittal, newest first.
- **A home and a menu:** the current documents and the transmittals awaiting me, for everyone the
  app is for; every transmittal, those returned with comments, and the superseded revisions counted
  for document controllers.
- **Three number series,** `DWG` for drawings, revised `A`, `B`, `C`, `SPEC` for specifications
  and procedures, revised `1`, `2`, `3`, and `TR` for transmittals, which the package registers
  with the add-on.
- **A stand-in model, in its own component:** the `EngineeringDocument` type, its `engdoc` schema,
  the add-on's `ControlledDocument` facet, and, since 0.2.0, `Transmittal`, `TransmittalReceipt`,
  `ReviewCycle`, each with the add-on's facet and no schema of its own, the `TransmittalRegister`
  folder, three vocabularies and nine page providers. Fictional, and replaced whole when a real
  one comes.
- **A seed script,** with its controls, which writes five documents, nine revisions in all, through
  the server's numbering alone; and, since 0.2.0, the demo's three people and their groups, a
  transmittal issued to two of them, one of whom has acknowledged it, and a review cycle with a
  resolved thread and an open one.
- **A steps file,** `scripts/beta-harness/steps/controlled-documents-transmittals.mjs`, for demo
  steps 1 to 3, written and not yet run.
- **Not installed anywhere at 0.2.0.** Version 0.1.0 is installed on the local Docker Nuxeo; the
  package passes the pipeline; installing 0.2.0 with the add-on, and seeding it, are for the
  orchestrator (below).

## What is in it

| File                                                                                       | What it is                                                                                                               |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `bundle/agentic-ui-config/app.json`                                                        | The app: id and address `controlled-documents`, its name, version, platform range and two groups                         |
| `bundle/agentic-ui-config/layouts/EngineeringDocument/view.layout.json`                    | The record page: the superseded banner, the Control and Document cards, the revisions, the review cycles and the history |
| `bundle/agentic-ui-config/layouts/Transmittal/view.layout.json`, `create.layout.json`      | A transmittal's record page, and its Create form                                                                         |
| `bundle/agentic-ui-config/layouts/TransmittalReceipt/view.layout.json`, `edit.layout.json` | A receipt's page, and the Edit form its recipient answers with                                                           |
| `bundle/agentic-ui-config/layouts/ReviewCycle/view.layout.json`, `edit.layout.json`        | A review cycle's page, and the Edit form its opener closes it with                                                       |
| `bundle/agentic-ui-config/queues/current.json`, `awaiting-me.json`, `transmittals.json`    | The three queues                                                                                                         |
| `bundle/agentic-ui-config/home.json`, `navigation.json`                                    | The home's five figures, and the menu                                                                                    |
| `bundle/agentic-ui-config/labels/en.json`                                                  | Its labels, in English: every key the files above name                                                                   |
| `bundle/OSGI-INF/controlled-documents-demo-config.xml`                                     | The component that contributes the layouts and the app                                                                   |
| `bundle/OSGI-INF/controlled-documents-demo-model.xml`, `bundle/schemas/`, `bundle/data/`   | **The stand-in model:** the types, the schema, their lifecycle, nine page providers and three vocabularies               |
| `bundle/OSGI-INF/controlled-documents-demo-series.xml`                                     | The three number series, for the add-on                                                                                  |
| `content-model.json`                                                                       | The model as the server would answer it, with the add-on's facets and schemas, for the pipeline                          |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/seed.selftest.mjs`                                 | The seed script, its fictional register and people, and its controls. Not packaged                                       |
| `package/package.xml`                                                                      | The Marketplace package: it depends on `nuxeo-agentic-ui` 2026.0.2 and `nuxeo-agentic-documents` 0.2.0                   |
| `build.mjs`                                                                                | Version 1's builder: the generator's, byte for byte                                                                      |

One version in three places: 0.2.0, in `package.xml`, `app.json`'s `packageVersion` and the
manifest's `Bundle-Version`.

## The record pages

### An engineering document

| Card                     | Shows                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `superseded` banner  | Only while `docctl:status` is `superseded`: "This revision is superseded. Work from the current revision:", and the successor's title, which opens it                                                                 |
| Control                  | Number, revision, status as a badge (`current` positive, `superseded` warning), series, the revisions it supersedes and is superseded by, each by its title, linked, and, since 0.2.0, the review cycles closed on it |
| Document                 | Title, category, discipline, project, issued for, originator (by name), issued on, description                                                                                                                        |
| Revisions of this number | Every live revision with this one's number, newest first, from `controlled_documents_revisions`                                                                                                                       |
| Review cycles            | Since 0.2.0, the document's review-cycle card: every cycle on this revision, newest first, open or closed, by whom, and how many threads, from `controlled_documents_review_cycles`; a row opens the cycle            |
| History                  | The record's audit                                                                                                                                                                                                    |

**The banner's link is a small addition to layout version 2,** since a banner held text only: a
banner may name, in `link`, a property of the open record that holds a record's id, and the page
shows that record by its title, as a `document-link` field does, as the banner's one action, which
opens it ([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 2). The validator holds
the link to a property of the type, and to one text, given the content model; a record the reader
may not read shows "Unavailable", disabled; the layout designer's read-only preview shows it
disabled. The Control card's `docctl:supersededBy` field says the same thing again, for a reader who
scrolled past the banner.

### A transmittal, and its receipts

| Page or form         | Shows                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transmittal          | The number, subject, purpose (from `ControlledDocumentsPurpose`), due day, who issued it and when, and the message; the documents as issued, number, revision and title, and the revisions sent, each by its title, linked; the Recipients card, each receipt's recipient, answer as a badge, comment and day; its comments; its history |
| Create a transmittal | Subject, purpose, due day, the documents by number (`DWG-00001`; an id works too), the recipients by user name, and a message. Offered by the Create menu of the transmittals register, a `TransmittalRegister`, whose one subtype it is                                                                                                 |
| Receipt              | A banner while it awaits, linking to the transmittal; what was sent, to whom, by whom and when due; the answer as a badge, the comment and the day; its history                                                                                                                                                                          |
| Answer a receipt     | The answer, from `ControlledDocumentsAnswer`, Acknowledged or Returned with comments, and the comment, required with a return. The record's Edit, for anyone the receipt's permissions let write it                                                                                                                                      |

### A review cycle

| Page or form    | Shows                                                                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review cycle    | A banner while it is open, linking to the revision reviewed; the revision, its number and revision, the cycle's state, its reviewers, due day, who opened and closed it and when, and how many threads; the threads to resolve; Nuxeo's comments, where the reviewers write; its history |
| Close the cycle | One field, the cycle's state, from `ControlledDocumentsCycleStatus`: Closed, saved, closes it, and the server refuses it while a thread is open, or from anyone but its opener                                                                                                           |

**Nothing on a page is a control.** The banners, badges and the Edit forms read and write what the
server checks. Whether anyone may read a transmittal, a receipt, a cycle or a revision, or write
one, is the server's permissions'; who may answer a receipt, comment in a cycle, resolve a thread
or close a cycle is the add-on's ([its README](../../../nuxeo-agentic-documents/README.md)).

**What a page does not do yet:** resolve a thread. The cycle's Threads card lists each with its
state; a row opens the comment as a document, whose own Edit form, generated from its schemas,
writes `rvwc:status` and `rvwc:resolution`. A Resolve action on the comments card would be the
platform's, and is not built. The steps file resolves over the REST API.

## The stand-in model

| Type                  | Schemas (prefix)                                                                                                                 | Facet                | What its own schema holds                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `EngineeringDocument` | `common`, `dublincore`, `engdoc` (`engdoc`), and the facet's `controlled_document` (`docctl`) and `controlled_review` (`docrev`) | `ControlledDocument` | `discipline`, `category`, `project`, `originator`, `purpose`, `issuedOn`. Its title is `dc:title` |
| `Transmittal`         | `common`, `dublincore`, and the facet's `transmittal` (`trm`)                                                                    | `Transmittal`        | None: its subject is `dc:title`, its message `dc:description`                                     |
| `TransmittalReceipt`  | `common`, `dublincore`, and the facet's `transmittal_receipt` (`trr`)                                                            | `TransmittalReceipt` | None. `HiddenInCreation`: the server creates each one                                             |
| `ReviewCycle`         | `common`, `dublincore`, and the facet's `review_cycle` (`rvw`)                                                                   | `ReviewCycle`        | None                                                                                              |
| `TransmittalRegister` | A folder                                                                                                                         |                      | Its one subtype is `Transmittal`, so its Create menu offers it                                    |

- **The add-on's properties are the server's to write,** but what a creator or a recipient names:
  a new document its series, or the revision it supersedes; a transmittal its documents,
  recipients, purpose and due day; a receipt its answer; a cycle its revision, reviewers and due
  day, and then its close.
- **Not folders, and holding no file,** so each opens as a record page. A real register's drawings
  carry their files; the stand-in leaves them out, as its demo is about the register.
- **`EngineeringDocument` is in no folder's subtypes,** so the Create menu does not offer it: the
  seed writes the records. A create form naming the series, and one naming the revision a new one
  supersedes, are not built; nor is one for a review cycle, which is opened over the REST API.

| Page provider                               | Given         | Returns                                                             |
| ------------------------------------------- | ------------- | ------------------------------------------------------------------- |
| `controlled_documents_current`              | Nothing       | Current revisions, by number                                        |
| `controlled_documents_superseded`           | Nothing       | Superseded revisions, latest change first                           |
| `controlled_documents_revisions`            | A number      | Every revision with that number, newest first                       |
| `controlled_documents_awaiting_me`          | A user name   | Their receipts awaiting an answer, nearest due first                |
| `controlled_documents_transmittal_receipts` | A transmittal | Its receipts, by recipient                                          |
| `controlled_documents_transmittals`         | Nothing       | Every transmittal, newest first                                     |
| `controlled_documents_returned`             | Nothing       | Receipts returned with comments, latest first                       |
| `controlled_documents_review_cycles`        | A revision    | Its review cycles, newest first                                     |
| `controlled_documents_cycle_threads`        | A cycle       | Its threads, Nuxeo's comments with the add-on's facet, oldest first |

Each reads the repository, so it lists a write at once; none has an aggregate; each leaves out
versions, proxies and trashed records. The queue and the home card of transmittals awaiting me
give `$currentUser`, which the REST API's page provider endpoint replaces with the person signed
in, so no one's name is in a file. `content-model.json` describes the types as a server with both
packages installed would answer: `common` and `dublincore` as the generator wrote them, and the
types, their schemas and the add-on's facets in the export's shape, since no server has 0.2.0 yet.

| Vocabulary                       | Its ids, which the add-on checks        | For                     |
| -------------------------------- | --------------------------------------- | ----------------------- |
| `ControlledDocumentsPurpose`     | `review`, `construction`, `information` | A transmittal's purpose |
| `ControlledDocumentsAnswer`      | `acknowledged`, `returned`              | A receipt's answer      |
| `ControlledDocumentsCycleStatus` | `open`, `closed`                        | Closing a review cycle  |

## How it was built

Version 0.1.0, in a checkout of `staging/enterprise-grade-app`, on Node 24.22.1, with the
generators, then by hand where they stop:

```bash
npx nx g ./tools/satori-generators:app-package controlled-documents-demo --owner=nuxeo --appId=controlled-documents --title="Controlled documents" --vendor="Nuxeo" --groups=document-controllers,engineers
npx nx g ./tools/satori-generators:app-model --package=business-apps/packages/controlled-documents-demo --type=EngineeringDocument --schema=engdoc --prefix=engdoc "--properties=discipline=Civil|Mechanical|Electrical|Process,category=Drawing|Specification|Procedure,project,originator,purpose=For information|For review|For construction|As built,issuedOn:date" --pageProvider=controlled_documents_current "--where=docctl:status = 'current'"
npx nx g ./tools/satori-generators:app-model --package=business-apps/packages/controlled-documents-demo --type=EngineeringDocument --pageProvider=controlled_documents_revisions "--where=docctl:number = ?" --sort=dc:created:desc --pageSize=20
npx nx g ./tools/satori-generators:app-model --package=business-apps/packages/controlled-documents-demo --type=EngineeringDocument --pageProvider=controlled_documents_superseded "--where=docctl:status = 'superseded'"
npx nx g ./tools/satori-generators:app-layout --package=business-apps/packages/controlled-documents-demo --type=EngineeringDocument --model=business-apps/packages/controlled-documents-demo/content-model.json
npx nx g ./tools/satori-generators:app-queue --package=business-apps/packages/controlled-documents-demo --id=current --pageProvider=controlled_documents_current --columns=docctl:number,dc:title,docctl:revision,engdoc:discipline,engdoc:category,engdoc:issuedOn --sort=docctl:number --pageSize=50 "--label=Current documents"
npx nx g ./tools/satori-generators:app-registry --package=business-apps/packages/controlled-documents-demo
```

By hand: the `ControlledDocument` facet on the type, and the component's `<require>` of the
add-on's schema; the current documents sorted by number; the facet and its schema in
`content-model.json`, before `app-layout` read it; the series component and its line in the
manifest; the dependency on `nuxeo-agentic-documents`; the record page from the generator's two
cards (the banner and its link, the badge, the `document-link`s, the related list and the
timeline); the labels, the home and the menu, which have no generator; and the seed.

Version 0.2.0, the same way. By hand first: the four types in the model component, with the
add-on's facets, their lifecycle and the three vocabularies, and their facets and schemas in
`content-model.json`, since no generator writes a type with no schema of its own. Then:

```bash
P=business-apps/packages/controlled-documents-demo M=$P/content-model.json
npx nx g ./tools/satori-generators:app-model --package=$P --type=TransmittalReceipt --pageProvider=controlled_documents_awaiting_me "--where=trr:recipient = ? AND trr:status = 'awaiting'" --sort=trr:dueDate
npx nx g ./tools/satori-generators:app-model --package=$P --type=TransmittalReceipt --pageProvider=controlled_documents_transmittal_receipts "--where=trr:transmittal = ?" --sort=trr:recipient
npx nx g ./tools/satori-generators:app-model --package=$P --type=Transmittal --pageProvider=controlled_documents_transmittals --sort=trm:issuedAt:desc
npx nx g ./tools/satori-generators:app-model --package=$P --type=TransmittalReceipt --pageProvider=controlled_documents_returned "--where=trr:status = 'returned'" --sort=trr:respondedAt:desc
npx nx g ./tools/satori-generators:app-model --package=$P --type=ReviewCycle --pageProvider=controlled_documents_review_cycles "--where=rvw:document = ?" --sort=rvw:openedAt:desc --pageSize=20
npx nx g ./tools/satori-generators:app-layout --package=$P --type=Transmittal --model=$M
npx nx g ./tools/satori-generators:app-layout --package=$P --type=TransmittalReceipt --model=$M
npx nx g ./tools/satori-generators:app-layout --package=$P --type=ReviewCycle --model=$M
npx nx g ./tools/satori-generators:app-form --package=$P --type=Transmittal --mode=create --model=$M --title --required=dc:title,trm:documents,trm:recipients,trm:purpose,trm:dueDate
npx nx g ./tools/satori-generators:app-form --package=$P --type=TransmittalReceipt --mode=edit --model=$M --required=trr:status
npx nx g ./tools/satori-generators:app-form --package=$P --type=ReviewCycle --mode=edit --model=$M --required=rvw:status
npx nx g ./tools/satori-generators:app-queue --package=$P --id=awaiting-me --pageProvider=controlled_documents_awaiting_me --columns=dc:title,trr:purpose,trr:dueDate,trr:issuedBy --sort=trr:dueDate --pageSize=50 "--label=Transmittals awaiting me"
npx nx g ./tools/satori-generators:app-queue --package=$P --id=transmittals --pageProvider=controlled_documents_transmittals --columns=trm:number,dc:title,trm:purpose,trm:dueDate,trm:issuedBy,trm:issuedAt --sort=trm:issuedAt:desc --pageSize=50 "--label=Transmittals"
npx nx g ./tools/satori-generators:app-registry --package=$P
```

Then by hand: the cycle's threads page provider, which is over Nuxeo's comments and not a type of
the kit's; the pages and the forms from the generators' cards (the widgets, the vocabularies, the
banners and their links, the related lists, the comments and timeline cards, and only the fields a
person writes on the forms); the queues' widgets and `$currentUser`; the document's review-cycle
card and its record of closed cycles; the series for transmittals; the labels, the home and the
menu; the seed, its data and its controls.

## Checking it

| Check                                                                                                                       | Result                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run app-package -- business-apps/packages/controlled-documents-demo --platform 0.2.0 --previous <0.1.0, from staging>` | Passed, 26 November 2026: 14 files, 7 layouts held to the package's own `content-model.json`, "69 changes, which need a patch version. 0.2.0 raises the minor", the zip built and verified |
| `npm run app-upgrade -- --since origin/staging/enterprise-grade-app`                                                        | Every configuration kept, 0.2.0 held to 0.1.0                                                                                                                                              |
| `node business-apps/packages/controlled-documents-demo/demo/seed.selftest.mjs`                                              | 48 of 48 controls passed. Broken on purpose sixteen ways, one at a time, each turned a control red                                                                                         |

**Not seen on a server or in a browser.** No server has the add-on or the kit at 0.2.0, so the
pages have not been drawn with them, and the steps file has not run.

The seed's sixteen breakages: 0.1.0's seven (a number of its own written on creation; a `docctl:`
property written on an update; a chain continued over someone else's supersession; two chains
sharing a number not seen; the page providers not asked; the password printed; a refused sign-in
taken for no precondition), and 0.2.0's nine: an answer sent as the administrator; a resolution sent
as the administrator; the transmittal issued as the administrator; a number written on the
transmittal; an answer sent again on every run; the demo password printed; the receipts not
checked; a user someone else made taken over; the threads not checked.

## Installing it on a local Nuxeo

**Not run.** With the add-on 0.2.0, in one restart, as
[its README](../../../nuxeo-agentic-documents/README.md#installing-it-on-a-local-nuxeo) says. **Over
version 0.1.0,** which the local server has, the same commands upgrade both: 0.2.0 adds types,
page providers, vocabularies, a series, layouts, queues and labels, and removes none, so no record
needs deleting first, and the register seeded under 0.1.0 stays as it is. Then seed it again, below:
it adds the people, the folders, the transmittal and the review cycle, and leaves the register as it
was.

## Seeding it

With `NUXEO_USER` and `NUXEO_PASS` exported for an administrator, and
`CONTROLLED_DOCUMENTS_DEMO_PASSWORD` for the password the demo's people get:

```bash
node business-apps/packages/controlled-documents-demo/demo/seed.mjs
```

It creates the groups `document-controllers` and `engineers`, and three people:

| User    | Groups                              | In the demo                                                                     |
| ------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `avega` | `document-controllers`, `engineers` | The engineer: issues the transmittals, a reviewer of the seeded cycle           |
| `kosei` | `engineers`                         | The recipient: has acknowledged the seeded transmittal; opened the seeded cycle |
| `mlind` | `engineers`                         | A recipient whose receipt awaits; a reviewer whose thread is open               |

Both groups get `ReadWrite` on the workspace, so everyone may read and write the register, the
transmittals and the cycles; the add-on decides who answers, comments, resolves and closes. It
prints the home, the queue, a superseded revision and its current one, the transmittal and the
review cycle. A user or a group of those names that the seed did not create stops it, before
anything is written.

### Seeing it under `nx serve`

Under `npx nx serve nuxeo-ui` the app reads its layouts from `/agentic-ui-config/` on its own port,
which `npm run config:dev` writes, as the Payers kit's README says. From the repository's root:

```bash
C=business-apps/packages/controlled-documents-demo/bundle/agentic-ui-config && npm run config:dev -- --layout EngineeringDocument/view=$C/layouts/EngineeringDocument/view.layout.json --layout Transmittal/view=$C/layouts/Transmittal/view.layout.json --layout Transmittal/create=$C/layouts/Transmittal/create.layout.json --layout TransmittalReceipt/view=$C/layouts/TransmittalReceipt/view.layout.json --layout TransmittalReceipt/edit=$C/layouts/TransmittalReceipt/edit.layout.json --layout ReviewCycle/view=$C/layouts/ReviewCycle/view.layout.json --layout ReviewCycle/edit=$C/layouts/ReviewCycle/edit.layout.json --home $C/home.json --navigation $C/navigation.json --labels en=$C/labels/en.json --queue $C/queues/current.json --queue $C/queues/awaiting-me.json --queue $C/queues/transmittals.json
```

Then start the dev server, or restart it: it serves only the files that were there when it
started. Sign in as one of the demo's people, with the demo password.

## Running the demo

### Steps 1 to 3, as a steps file

```bash
NUXEO_USER=avega NUXEO_PASS="$CONTROLLED_DOCUMENTS_DEMO_PASSWORD" npm run beta:evidence -- controlled-documents-transmittals
```

Its header says what it checks, what it needs, and what it does not cover. It runs on a drawing of
its own each time, so the seeded register reads the same afterwards.

### By hand

1. **An engineer issues a transmittal,** here to a person inside the server: as `avega`, open the
   transmittals register, Create, Transmittal. Subject, purpose For review, a due day, the pump
   house drawing's number, `kosei`, Create. The record page shows its number, `TR-…`, the drawing
   at its current revision, and the Recipients card `kosei`, awaiting.
2. **The recipient comments and returns it:** as `kosei`, the home's Transmittals awaiting me opens
   the queue; open the receipt, Edit, Returned with comments, a comment, Save. The transmittal's
   Recipients card shows returned, with the comment. As anyone else, the same answer is refused,
   403, whatever they may write; a second answer is refused, 409. The review comments are a review
   cycle's: the seeded one on the intake screen drawing has a resolved thread and an open one; its
   opener, `kosei`, closing it through its Edit form is refused, 409, until the open thread is
   resolved.
3. **The new revision supersedes the old one,** live: create a revision D over C through the REST
   API, as a person who may write C:

   ```bash
   curl -s --fail-with-body -u "avega:$CONTROLLED_DOCUMENTS_DEMO_PASSWORD" -H 'Content-Type: application/json' \
     -X POST http://localhost:8080/nuxeo/api/v1/path/default-domain/workspaces/controlled-documents/register \
     -d '{"entity-type":"document","type":"EngineeringDocument","name":"pump-house-ga-d","properties":{"dc:title":"Pump house general arrangement, revision D","docctl:supersedes":"<C'\''s id>"}}'
   ```

   The answer has C's number and revision `D`; C's page now shows the banner, linking to D; the
   queue shows D in C's place. A transmittal already issued keeps C, as it was sent.

## Not done yet

- **Installed anywhere at 0.2.0, or seeded:** waiting on the orchestrator.
- **Outside users and the portal** (decision C): a transmittal to an outside contractor, who signs
  in to the portal to comment and return it, demo steps 1 and 2 as the plan writes them.
- **A create form for a new revision,** naming the one it supersedes, so that step 3 runs in the
  app rather than through the REST API; nor one for a review cycle.
- **Resolving a thread in the app,** above; reminders of what awaits or is late.
- **Export-control marks**, the rest of phase 8's document control.
- **Files.** The stand-in type holds none; a real register's revisions carry their drawings.
