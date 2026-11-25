# Layout Designer

The designer in the shell, phase 6 of the business apps
[development plan](../../../docs/business-apps/development-plan.md), in two slices:

- **Layout files**, [version 2](../../../docs/business-apps/layout-v2.md): an administrator opens a
  type's record page, edit form or create form, changes it, sees what it draws for a real record,
  and saves it as a download.
- **Queues**, [`queues/<id>.json`](../../../docs/business-apps/app-definition-v2.md): an administrator
  opens a queue, changes its name, columns, sort and facets, sees the queue page it draws against the
  server's page provider, and saves it as a download.

It edits configuration only. It loads no customer code and builds no plugin: how customer code runs
is decision 5, still open ([decision log](../../../docs/business-apps/decisions.md)).

## Where it is

- **`/#/administration/layout-designer`**, "Layout Designer" in the Administration menu, for
  administrators: its layout files. **`/#/administration/layout-designer/queues`**: its queues. Two
  links at the top of each page open the other.
- **The gate:** the app mounts the routes behind `adminGuard`, which lets administrators and power
  users in once the session is read, and each route itself is behind `fullAdministratorGuard`, which
  lets administrators alone. Power users are not offered the menu entry, and are sent to their own
  administration page.
- **Not a security control.** Hiding the page from everyone else protects nothing: the designer
  writes nothing to the server, and the server's permissions decide what anyone may read or change.
  A field a layout hides is still returned by the server to anyone who may read the record, and a
  queue's page provider returns only what each person may read.

## Layout files

1. **Opens a file**, chosen in "Layout file" and opened by its button. For each type `layouts.json`
   lists a record page, an edit form or a create form for, it offers all three: the record page
   (`view`), the edit form (`edit`) and the create form (`create`). A type served only another mode,
   such as `metadata`, is not offered. A served file is read as the server serves it now, not from the
   session's cache, through `DocumentLayoutService.servedLayouts` and `layoutSource`; an index that
   cannot be read says so, rather than listing no file. One the server does not serve is opened as a
   new file, one card with no field, to add the type's properties to. A file that could not be read is
   read again when it is opened again.
2. **Edits it:**
   - moves a field up or down in its card, the focus moving with it;
   - hides a field: it is taken out of the file, and listed under "Hidden fields" to be shown again,
     where it was, while the file is open;
   - adds a property of the type, from the server's content model, as the card's last field,
     written `"<prefix>:<name>"` so that its schema type picks the widget;
   - sets a card's id, its heading text (`label`) and its heading key (`labelKey`). An empty heading
     text or key is taken out of the file rather than written empty;
   - sets a field's rules, under "Rules of" the field: when it shows (`visibleWhen`), in every mode;
     and in a form, whether it is required (`required`: not, always, or while a rule passes) and when
     it is read-only (`readOnlyWhen`). A rule is written as configuration: a registered rule's ID, such
     as `app.rules.canWrite`, or a rule as JSON, as layout-v2.md, section 5, writes one. Text that is
     not JSON is written as an ID, as typed, so the validator refuses what is no rule rather than the
     designer guessing. A field written `"<prefix>:<name>"` becomes an object to hold a rule, and a
     string again once it holds none. A required rule chosen and not yet written is written empty, and
     refused until it is.

   A card of related records, a timeline, comments, another system's fields or a checklist is listed
   with its heading, and its contents are edited in the file. Every key the designer does not edit is kept as it was written, a key version 2
   does not have included.

3. **Previews it** against a record of the type: the last 20 changed, live ones, read with
   `queryParams`, never written into the query (`DocumentLayoutService.previewRecords`). The preview is
   **read-only**, and what the engine leaves out of the file, and why, is listed under it, in the words
   the console uses, and the console is not told it.
   - **A record page** is drawn by the record page engine, `lib-record-page`: the file is read, held to
     the record's type and resolved as the View tab resolves a served file
     (`DocumentLayoutService.previewRecordLayout`). A comments card shows no comment box, and a related
     list offers no row action, so drawing the page writes nothing.
   - **An edit or create form** is drawn by the form engine, `lib-document-layout-form`, given the
     resolved file as its `preview` (`DocumentLayoutService.previewFormLayout`), as the Edit and Create
     forms resolve a served one: an edit for the record, held to its own facet schemas too, and a create
     for a new record in the record's folder. Every input is read-only, and the page offers no Save: the
     form's host owns Save, and here there is none, so nothing is sent. A contributed form
     (`documentEdit`, `documentCreate`) does not take the preview's place.
4. **Validates every change** with the app definition's validator, `validateLayoutV2`, in the file's
   mode, with the platform's registries and the rules and row actions this build registers, and held to
   the server's content model once it is read (`readContentModel`). Each finding is listed with its
   place, its message and its kind, and the verdict is announced to a screen reader. In the file's mode
   means that a key a mode does not have is refused: `required` on a record page, a related list in a
   form.
5. **Saves** the file as a download, `<mode>.layout.json`, as a package holds it at
   `layouts/<Type>/<mode>.layout.json`, and as `npm run config:dev -- --layout <Type>/<mode>=<file>`
   serves it, given every other file served too, since that command writes the whole folder again.
   Nothing is written to the server.
6. **Asks before a change is lost:** opening another file, leaving the page by the app's router, a
   link in the preview included, and reloading or closing the tab each ask first while the file has a
   change or a hidden field. A new file left as it was opened loses nothing. Signing out, and the idle
   timeout, do not ask: the session has ended by then, and the record must not stay on screen.

## Queues

1. **Opens a queue** by its id, typed or chosen among those the app's menu, `navigation.json`, opens,
   and its button. Its file is read as the queue page reads it, through `QueueService.load` and
   `APP_DEFINITION_FILES`: where the development server serves it, and otherwise from the app
   registry, for the app open. An id that cannot name a queue is never asked for, and a queue that
   could not be read is read again when it is opened again.
2. **Edits it:** its name (`label`, `labelKey`); its columns, moved, hidden and shown again, and added
   from the properties of the server's content model, every type's, since a queue's rows may be of any
   type its page provider returns; its sort, on its columns, each ascending or descending, in order;
   and its facets, each an aggregate of the page provider by its id on the server, with its own name.
   An empty `sort` or `facets` is taken out of the file. Its page provider, parameters, page size, row
   and bulk actions and rule are edited in the file.
3. **Previews it** with the queue page, `lib-queue-page`, given the file as edited as its `content`, and
   `readOnly`: the page provider is asked for its records as the administrator, page by page, and a
   facet filters them, but no row can be selected, and no row action, bulk action or action over the
   whole query is offered, so nothing on it changes a record. It leaves the app's selection, and what
   the selection bar offers, as they were. What the queue page leaves out of the file, and why, is
   listed under it (`readQueue`), and the console is not told it; a file it refuses is not drawn, and
   its reasons are shown instead. A queue with a rule of its own, `visibleWhen`, is drawn only if the
   administrator is among the people it is for, as the queue page draws it for anyone, and the page
   says so above the preview.
4. **Validates every change** with `validateQueue`, with the platform's registries, the rules, row
   actions and bulk actions this build registers, and the app's own actions from its `actions.json`,
   as the pipeline adds them (`withPackageActions`), once that file is read. The page says whether it
   is: the development server never serves `actions.json`, and the app registry serves it only for an
   app the administrator may see. Without it, an action of the app's own is unknown, and a queue that
   names one is refused, as the pipeline refuses it without the file. The `actions.json` is the app
   open's, from the registry: a queue the development server serves may be another app's, whose
   actions it then is not checked against, and the page says so. The validator does not hold a queue
   to the content model: its columns are other records'.
5. **Saves** the file as a download, `<id>.json`, as a package holds it at `queues/<id>.json`, and as
   `npm run config:dev -- --queue <file>` serves it, under its name.
6. **Asks before a change is lost**, as for a layout file.

## What it refuses

- **A file with any finding cannot be saved,** a layout file or a queue. That is the pipeline's
  verdict, `publishable`, since the file goes into a package the pipeline then checks. The tolerant
  verdict the engines load with, `loadable`, is not enough: a field the content model refuses would be
  left out of the page, and the package refused. The button is turned off, and `download()` refuses
  too, whatever calls it.
- **A layout file, not before the content model is read,** and **a queue, not before the app's own
  actions are read** or known not to be served. Each may be saved once it has been checked with them.
- **When the model cannot be read,** whether a request fails or the model reader refuses part of it,
  the page says the layout file is not held to it, every other check is made, and a file they find
  nothing in may be saved. That is the pipeline's rule too: it holds a package to a model only when it
  is given one. A field whose property the type lacks then passes, and the engine leaves it out.

## Not done yet

- **Publishing** to a server is not built: the app registry has no write API, and a package is
  installed with `nuxeoctl`. The plan's approval step before publishing is not built either.
- **The rest of the plan's designer:** actions, the `metadata` mode and task forms; in a layout file,
  tabs, cards, columns, widgets and their parameters, checks across fields, computations and related
  lists are edited in the file, not here. A rule has no builder: it is written as its ID or its JSON.
- **A facet's aggregate is typed,** not offered: the page provider's definition, which lists its
  aggregates, is not read. One the results do not have is not drawn, as on the queue page.
- **A form is previewed read-only,** so a rule that follows a value as it is typed is seen only for the
  values the chosen record holds.
- **A queue of an app's own actions, under `config:dev`.** The development server serves no
  `actions.json`, and the app registry serves an app's only to its groups, so a queue naming one of
  the app's own actions, such as the Payers kit's `my-claims`, cannot be downloaded there, even
  unchanged, unless the administrator is in one of the app's groups on a server with the package.
- **A queue whose rule is not for the administrator** previews as the queue page shows it to them:
  "not shown". Every Payers queue is for `claims-adjusters`.
- **Byte for byte.** The download is the same JSON as the file, not the same bytes: it is written two
  spaces deep, as `JSON.stringify` writes it, and a hand-written file formatted by Prettier keeps short
  objects on one line. Phase 6's round trip, the designer's output matching the hand-written JSON
  byte for byte, is not met.
- **Rules on the document page's own state.** Where the document page is not open, nothing publishes
  its state about the record: locked, a favourite, followed, in the clipboard, versioned, an action in
  progress. A banner, card or field whose rule reads that state, such as `app.rules.isLocked`, previews
  as on a record with none of it, which the View tab or the Edit form of a locked record would not show.
- **Each change draws the preview again,** and a related list or a queue reads its records again; a
  facet's chosen buckets are forgotten with each change to the queue.
- **A navigation another replaces while it asks,** such as two quick clicks in the menu, leaves its
  question open, and answering it then does nothing.
- **What an engine tells the console when it draws**, such as a widget shown as its property's own
  value in this build, or a facet the results do not have, stays in the console: only what it is told
  when the file is read is listed. A read of the type or a schema that fails is told the console too,
  as on any page.

## Tests

```bash
npx nx run-many -t lint,typecheck,test -p layout-designer
```

- `layout-designer-page.spec.ts` and `queue-designer-page.spec.ts` hold the pages with stand-ins for
  the engines; `layout-designer-page.engine.spec.ts` holds the layout page with the real
  `DocumentLayoutService`, `lib-record-page` and `lib-document-layout-form`, and
  `queue-designer-page.engine.spec.ts` the queue page with the real `QueueService` and
  `lib-queue-page`, the server answered by `HttpTestingController`; both check that every request is
  a read.
- The route's guards are checked by identity, as `libs/features/administration` checks its own; the
  guards themselves are `libs/shared/nuxeo-client`'s and `apps/nuxeo-ui`'s, tested there.
- **Every guard was broken on purpose and its test seen failing.** The first slice's: the save
  refusal (in `download()`, on the button, `publishable` rather than `loadable`, and waiting for the
  model), the model given to the validator, the record page's read-only mode, the type kept out of
  the records query's text, a model read in part refused, the build's own rules known, the route's
  administrator guard, the edits copying the file they are given, the focus moving with a field, and
  asking before a change is lost. The second slice's:
  - **saving a form:** `download()` and the button for a refused file, `loadable` as the verdict,
    saving before the model is read, the validator not given the file's mode, a required rule not
    written left out rather than refused, text that is not JSON dropped rather than written, a rule
    written into the file given rather than a copy, and a field left an object once it holds no rule;
  - **the form's preview:** drawn without `disabled`, the served form drawn rather than the file as
    edited, the preview's layout not drawn, a contributed form taking its place, the served file read
    for it, the console told its notes, a create held to the chosen record's facets, and the edited
    record not passed to it;
  - **saving a queue:** `download()` and the button for a refused file, the validator not run, the
    app's own actions not given to it, saving before they are read, `actions.json` asked of the
    development server, and an id that cannot name a queue opened;
  - **the queue's preview:** drawn without `readOnly`, the served queue drawn rather than the file as
    edited, row actions, bulk actions and actions over the whole query offered read-only, the file
    given ignored, the console told its problems, the app's selection cleared by a facet, and the
    selection bar's offer set, or reset, by the preview;
  - **access and the rest:** the queues route without its administrator guard or its question before
    leaving, a changed queue left without asking, a new file read from the server, modes other than
    the three offered, a menu entry's queue taken whatever its id, a file or a queue that could not be
    read not read again, the focus lost when a facet is removed, a form's preview using the record
    page's words, the verdict saying a file or a queue can be saved while what it is checked with is
    still read, an `actions.json` with no actions claimed as the app's, and the administration menu
    not marking Layout Designer on its queues page.
