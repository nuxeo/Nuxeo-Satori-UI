# Layout Designer

The first slice of the designer in the shell, phase 6 of the business apps
[development plan](../../../docs/business-apps/development-plan.md): an administrator opens a record
page's layout file, [version 2](../../../docs/business-apps/layout-v2.md), changes it, sees the page it
draws for a real record, and saves it as a download.

It edits configuration only. It loads no customer code and builds no plugin: how customer code runs
is decision 5, still open ([decision log](../../../docs/business-apps/decisions.md)).

## Where it is

- **`/#/administration/layout-designer`**, "Layout Designer" in the Administration menu, for
  administrators.
- **The gate:** the app mounts the route behind `adminGuard`, which lets administrators and power
  users in once the session is read, and the route itself is behind `fullAdministratorGuard`, which
  lets administrators alone. Power users are not offered the menu entry, and are sent to their own
  administration page.
- **Not a security control.** Hiding the page from everyone else protects nothing: the designer
  writes nothing to the server, and the server's permissions decide what anyone may read or change.
  A field a layout hides is still returned by the server to anyone who may read the record.

## What it does

1. **Opens a record page** that the server serves, chosen in "Record page" and opened by its button:
   the types `layouts.json` lists a `view` file for. The index and the file are read as the server
   serves them now, not from the session's cache, through `DocumentLayoutService.recordLayoutTypes`
   and `recordLayoutSource`; an index that cannot be read says so, rather than listing no page.
2. **Edits it:**
   - moves a field up or down in its card, the focus moving with it;
   - hides a field: it is taken out of the file, and listed under "Hidden fields" to be shown again,
     where it was, while the file is open;
   - adds a property of the type, from the server's content model, as the card's last field,
     written `"<prefix>:<name>"` so that its schema type picks the widget;
   - sets a card's id, its heading text (`label`) and its heading key (`labelKey`). An empty heading
     text or key is taken out of the file rather than written empty.

   A card of related records, a timeline, comments, another system's fields or a checklist is listed
   with its heading, and its contents are edited in the file. Every key the designer does not edit is kept as it was written, a key version 2
   does not have included.

3. **Previews it** with the record page engine, `lib-record-page`, against a record of the type: the
   last 20 changed, live ones, read with `queryParams`, never written into the query
   (`DocumentLayoutService.previewRecords`). The file is read, held to the record's type and resolved
   as the View tab resolves a served file (`DocumentLayoutService.previewRecordLayout`). What the page
   leaves out of the file, and why, is listed under the preview, in the words the console uses, and the
   console is not told it. The preview is **read-only**: a comments card shows no comment box, and a
   related list offers no row action, so drawing the page writes nothing.
4. **Validates every change** with the app definition's validator, `validateLayoutV2`, in `view` mode,
   with the platform's registries and the rules and row actions this build registers, and held to the
   server's content model once it is read (`readContentModel`). Each finding is listed with its place,
   its message and its kind, and the verdict is announced to a screen reader.
5. **Saves** the file as a download, `view.layout.json`, as a package holds it at
   `layouts/<Type>/view.layout.json`, and as `npm run config:dev -- --layout <Type>/view=<file>`
   serves it, given every other file served too, since that command writes the whole folder again.
   Nothing is written to the server.
6. **Asks before a change is lost:** opening another type, leaving the page by the app's router, a
   link in the preview included, and reloading or closing the tab each ask first while the file has a
   change or a hidden field. Signing out, and the idle timeout, do not ask: the session has ended by
   then, and the record must not stay on screen.

## What it refuses

- **A file with any finding cannot be saved.** That is the pipeline's verdict, `publishable`, since the
  file goes into a package the pipeline then checks. The tolerant verdict the record page loads with,
  `loadable`, is not enough: a field the content model refuses would be left out of the page, and the
  package refused. The button is turned off, and `download()` refuses too, whatever calls it.
- **Not before the content model is read.** A file may be saved once it has been held to the model.
- **When the model cannot be read,** whether a request fails or the model reader refuses part of it,
  the page says the file is not held to it, every other check is made, and a file they find nothing in
  may be saved. That is the pipeline's rule too: it holds a package to a model only when it is given
  one. A field whose property the type lacks then passes, and the record page leaves it out.

## Not done yet

- **Publishing** to a server is not built: the app registry has no write API, and a package is
  installed with `nuxeoctl`. The plan's approval step before publishing is not built either.
- **The rest of the plan's designer:** queues, actions and the other modes; tabs, cards, columns,
  widgets, rules and related lists are edited in the file, not here.
- **Byte for byte.** The download is the same JSON as the file, not the same bytes: it is written two
  spaces deep, as `JSON.stringify` writes it, and a hand-written file formatted by Prettier keeps short
  objects on one line. Phase 6's round trip, the designer's output matching the hand-written JSON
  byte for byte, is not met.
- **Rules on the document page's own state.** Where the document page is not open, nothing publishes
  its state about the record: locked, a favourite, followed, in the clipboard, versioned, an action in
  progress. A banner, card or field whose rule reads that state, such as `app.rules.isLocked`, previews
  as on a record with none of it, which the View tab of a locked record would not show.
- **Each change draws the page again**, and a related list on it reads its records again.
- **A navigation another replaces while it asks,** such as two quick clicks in the menu, leaves its
  question open, and answering it then does nothing.
- **What the record page tells the console when it draws**, such as a widget shown as its property's
  own value in this build, stays in the console: only what it is told when the file is read is listed.
  A read of the type or a schema that fails is told the console too, as on any page.

## Tests

```bash
npx nx run-many -t lint,typecheck,test -p layout-designer
```

- `layout-designer-page.spec.ts` holds the page with a stand-in for the record page;
  `layout-designer-page.engine.spec.ts` holds it with the real `DocumentLayoutService` and
  `lib-record-page`, the server answered by `HttpTestingController`, and checks that every request is a
  read.
- The route's guards are checked by identity, as `libs/features/administration` checks its own; the
  guards themselves are `libs/shared/nuxeo-client`'s and `apps/nuxeo-ui`'s, tested there.
- **Every guard was broken on purpose and its test seen failing:** the save refusal (in `download()`,
  on the button, `publishable` rather than `loadable`, and waiting for the model), the model given to
  the validator, the preview's read-only mode, the type kept out of the records query's text, a model
  read in part refused, the build's own rules known, the route's administrator guard, the edits copying
  the file they are given, the focus moving with a field, and asking before a change is lost.
