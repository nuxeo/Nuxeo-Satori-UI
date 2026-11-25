# Layout Designer

The designer in the shell, phase 6 of the business apps
[development plan](../../../docs/business-apps/development-plan.md), in three slices:

- **Layout files**, [version 2](../../../docs/business-apps/layout-v2.md): an administrator opens a
  type's record page, edit form or create form, changes it, sees what it draws for a real record,
  and saves it as a download.
- **Queues**, [`queues/<id>.json`](../../../docs/business-apps/app-definition-v2.md): an administrator
  opens a queue, changes its name, columns, sort and facets, sees the queue page it draws against the
  server's page provider, and saves it as a download.
- **Publishing**, the app's [deployment layer](#publishing-the-deployment-layer): on a server that
  switches it on, an administrator saves either file as a draft, submits it, and a second
  administrator approves it, which publishes it for everyone in the app's groups; any administrator
  rolls it back. **This changes the app for every user of it from an administrator's screen.**

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
- **Not a security control.** Hiding the page from everyone else protects nothing: the server
  decides what anyone may read or change. The designer writes only to the deployment layer, whose
  every address refuses anyone the server does not count an administrator, whatever the page shows.
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
   The download writes nothing to the server; the deployment layer, below the Save section, does.
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
   `npm run config:dev -- --queue <file>` serves it, under its name; and, on a server that switches
   it on, to the app's deployment layer, below.
6. **Asks before a change is lost**, as for a layout file.

## Publishing: the deployment layer

**This changes the app for every user of it from an administrator's screen.** A file published here
is what everyone in the app's groups sees on that server, on every page that draws it, until it is
changed again or rolled back. It is built against the open decisions B and E
([decision log](../../../docs/business-apps/decisions.md), notes), and the server side is
`LayerService` in [`nuxeo-agentic-core`](../../../nuxeo-agentic-core/src/main/java/org/nuxeo/agentic/config/LayerService.java).

### What it is

- **An app's deployment layer** holds a customer's own versions of its layout files, a type's record
  page, edit form and create form (`layouts/<Type>/<view|edit|create>.layout.json`), and its queues
  (`queues/<id>.json`), stored in the server's repository. Nothing else: not the labels, the menu,
  the home, the actions or `app.json` (`LayerPaths`).
- **Precedence** ([app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md), section
  10, "The deployment layer"): above the package's file at the same path, the customer's overlay of
  the architecture's "starter kit, then customer, then tenant, then environment"; and below the
  manifest's labels, which it does not touch: a heading's `labelKey` is still looked up as before, so
  a text the manifest gives a key wins over the app's own.
- **Who sees it:** the app registry serves the live version, after sign-in, to the people in the
  app's groups, in place of the package's file (decision E). The record page and the forms read a
  layer layout first for the app open (`DocumentLayoutService`), and queues are read from the
  registry already. **The configuration servlet, which everyone reads before sign-in, never reads a
  layer**: its answers are the packages' alone, drafts and live versions both left out. Someone in
  none of the app's groups keeps the package's file.

### The panel

Below the Save section of either page, for the file open:

- **Package's version, live version and draft**, side by side, each as its JSON text, and their
  differences: package to live, live (or package) to draft, and the newest of them to the file as
  edited here. Nothing in a version is drawn as markup.
- **Save draft** sends the file as edited, once the page's own check finds nothing in it. **Submit
  for approval** puts the draft up. **Approve and publish** makes it live. **Roll back** takes the
  live version out, and its question names what goes back: the version an approval replaced, or
  the package's version. **Put the package's version back** does that whatever is live.
  **Discard draft** drops it. **Open the newest version here** loads the draft, or the live version,
  into the designer to edit.
- **The buttons follow the server's answer** of what the person may do, and one that may do nothing
  is turned off, with the server's reason for an approval, not hidden. That is not the control: the
  server refuses whatever is sent.
- **Approve, roll back and discard ask first.**

### What the server enforces

- **Who:** administrators alone, as Nuxeo counts them (`NuxeoPrincipal.isAdministrator`), read or
  change a layer, its drafts, versions and trail included. Anyone else is 403 at every address,
  before anything is read, the body of a change included, so no one else learns whether an app or a
  file has a layer, or whether the layer is switched on. Power users are not administrators.
- **Every write is validated on the server** with the app definition's own validator, against the
  server's content model as it is then: `validateFile` from `libs/shared/app-definition`, the
  pipeline's check of one file, built into a script (`npm run app-definition:server-validator`) that
  the server runs in Nashorn 15.7, the engine Nuxeo LTS 2025 ships in `nxserver/lib`, with no access
  to Java and none of the host's own functions (`load`, `exit` and the rest). A file with any
  finding, a path no layer holds, a model that cannot be read, or a validator that cannot run
  refuses the write, 422, whatever the client checked. A queue is held to the app's own
  `actions.json` **as the registry serves it**, after the server's allow-list of operations
  (`org.nuxeo.agentic.ui.operations`, the operation buttons'): a layer's queue can name an action
  that runs an operation only while the allow-list lets that operation run. One it no longer lets
  run refuses the write, and a live queue that names it is no longer served, since the live layer
  is checked again whenever the allow-list changes; the queue page and `AgenticUi.RunAction` would
  leave the action out anyway. A layer cannot hold `actions.json`, so it can name only the
  package's actions, never add one. What the deployment registers in code beyond the platform comes from
  `nuxeo.agentic.ui.layer.registered.rules`, `.rowActions` and `.bulkActions`, set alike on every
  server of a cluster, as `selfApproval` must be.
- **Checked again when served:** each live file is held to the validator once more when the
  registry reads the layer, against the configuration in force, and one it finds anything in is not
  served, and logged, so the package's file shows. That covers a model or `actions.json` changed by
  an upgrade, and a stored layer written around the service.
- **Draft and approval:** a change is first a draft, which the registry never serves. It goes live
  when an administrator approves it who neither wrote any of the draft nor submitted it.
  **The default is a second administrator**, because a change here reaches everyone in the app's
  groups at once, and four eyes on it is the cheapest check there is; a server with one
  administrator sets `nuxeo.agentic.ui.layer.selfApproval=true`, which lets the same one approve, and
  the server log says so at startup. Approval checks the draft again against the model as it is
  then, and refuses a draft made on a live version that has since changed.
- **Every publish keeps the previous version:** each approval or rollback is a new version; the last
  50 of a file are kept, and the live one always. **A rollback takes the live version out**, at
  once and by one administrator: it puts back the version an approval replaced, or the package's
  file, and nothing else. A rollback is never undone by another: after one, the next puts the
  package's file back, and what a rollback took out goes live again only as a draft a second
  administrator approves. So one administrator can withdraw a change in an incident, and cannot
  bring back one another withdrew. It checks the restored version against the model first; the
  package's file needs no check. A rolled-back version keeps the makers and approver of the one it
  restores, and names who put it back. An older version is not rolled back to: bringing it back
  means saving it again as a draft, and reading an older version's content is not built yet.
- **Concurrent edits:** every change names the file's revision, and one made on a revision that is
  no longer the file's is refused, 409, with the file as it is now. Every change, to any app, is
  made one at a time: on a server by the service's lock, and across a cluster inside
  `ClusterService.runAtomically`, one lock for the layer; the repository's change token refuses a
  write made on a stale read, and the change is applied again to the layer as it then is, and
  refused if its own file moved. A read of the layer made while a change is written is not kept.
- **Audit:** every change is a line of the file's trail, kept with the layer, with who, when, the
  action, the revision and the version and content digest it made, and a line in the server log;
  every refused change is a warning in the log with who asked and why. Nuxeo's own audit log records
  the layer document's changes as the system's, the service writing with a privileged session.
- **Not a control against administrators:** a Nuxeo administrator can write the stored document
  directly, through the REST API, as they can install a package or change what the server runs.
  Nuxeo's audit log records such a write under their name, not the system's, and the registry
  serves none of its live files the validator does not pass; but the trail in it can be rewritten,
  and an approval forged, by whoever does that.
- **Limits:** a layer holds at most 500 files and 64 MiB, versions and trail included; a change
  over either is refused, 413, but for a rollback or a discard, so that an incident can always be
  undone. A file's trail keeps its last 1000 lines and counts those let go (`trailDropped`); the
  server log keeps every one. A `core.template` text is at most 1000 characters, as the record
  page draws it, and every check the validator makes reads the file in one pass, so a check takes
  time in proportion to the file. A log line names only what the service names itself: an action,
  app or path the request chose that is not one is written as a place-holder.
- **When the live version is not served,** because the validator refuses it as the server is now,
  the state says so (`served: false`), the panel warns, and the export says so too.
- **A change** is a POST of `application/json` with the header `X-Agentic-Layer-Change`, which a
  page on another site cannot send without a CORS preflight, and the registry answers no preflight;
  at most 1 MiB and 64 KiB, nested at most 512 deep, with no repeated key. Every answer is
  `no-store`.
- **The switch:** `nuxeo.agentic.ui.layer.enabled`, off unless it is `true`, as new work is
  (decision J). Off, every address of the layer is 404 and the registry serves the packages' files,
  though the stored layer is kept. So turning it off also takes every customer change out at once.
- **In the repository:** one `File` document per app under `/agentic-ui-layers`, a folder hidden in
  navigation whose ACL blocks every permission and grants none, so only administrators, whom Nuxeo
  lets past every ACL, and the system read it. The ACL is checked each time the layer is read or
  written, and set back, with a warning in the log, when someone has changed it, as by sharing the
  folder; an app's document given an ACL of its own, as by sharing it, has it taken away. A block
  for a time only is no block.
- **CORS:** the change header holds only while no CORS configuration of the server
  (`nuxeo.cors.urls`, or a `corsConfig` contribution) lets another origin send it to
  `/nuxeo/agentic-ui-apps/`.
- **The registry's copy** of the live layer is read again after a change on the server, and at most
  10 seconds late for a change made on another server of a cluster; when nothing changed, a read
  costs each app's stamp alone. A read that changes something checks every live file again, on
  the request that makes it, and other requests wait for it: tens of milliseconds a file. A file
  the validator could not check at all is checked again at the next read.

### Upgrades

`npm run app-upgrade -- <kit> --previous <kit as it was> --deployment <file>` warns for each file the
kit's new version adds, changes or removes that the deployment overrides: the override keeps winning,
so the kit's change does not show there until it is taken into a new draft, or the override rolled
back. The file is what `GET /nuxeo/agentic-ui-apps/layer.json` answers an administrator. The panel
says so too: "The package's file has changed since this version was made on it."

### Installing it

**Not run here:** nothing was installed on, restarted or written to the local Nuxeo for this slice.
What it relies on was read from that server's jars with `javap`, read only: Nashorn 15.7 and ASM 9.9
in `nxserver/lib`; `CoreSession.CHANGE_TOKEN`, `CoreInstance.doPrivileged`,
`TransactionHelper.runInNewTransaction`, `ClusterService.runAtomically` and `SchemaJsonWriter` in
`nxserver/bundles`. The core module ships in the `nuxeo-agentic-ui` Marketplace package. On a local
Docker Nuxeo, as the kits' READMEs install a package:

1. **Build** the `nuxeo-agentic-ui` package with its version stamped, as `build-marketplace.yml`
   does or `npm run release-candidate` (docs/business-apps/package-pipeline.md, section 11): it
   writes `nuxeo-agentic-ui-package-<version>.zip`. A plain `mvn package` at the root writes
   `nuxeo-agentic-ui-package/target/nuxeo-agentic-ui-package-*.zip` too, but its `package.xml`
   says `@VERSION@`, which Nuxeo reads as 0.0.0, so it does not upgrade an installed one.
2. **Switch the layer on** in `nuxeo.conf`:

   ```properties
   nuxeo.agentic.ui.layer.enabled=true
   # Only on a server with a single administrator:
   # nuxeo.agentic.ui.layer.selfApproval=true
   ```

   In the Docker image that is `/etc/nuxeo/nuxeo.conf` itself, on a container that has started
   before. The image's `/docker-entrypoint.sh` merges `/etc/nuxeo/conf.d/` into it only at the
   container's first start, before it writes its `configured` marker (read from the local
   2025.10.18 container; [`nuxeo-conf/README.md`](../../../nuxeo-conf/README.md) says so in its
   "Local mail setup"), so a file copied into `conf.d` later is never read, and the layer stays
   off:

   ```bash
   docker exec nuxeo sh -c 'grep -q "^nuxeo.agentic.ui.layer.enabled=" /etc/nuxeo/nuxeo.conf || echo "nuxeo.agentic.ui.layer.enabled=true" >> /etc/nuxeo/nuxeo.conf'
   ```

   On a container not started yet, a `conf.d` file works.

3. **Install** with `nuxeoctl mp-install <zip> --accept=true` while the server is stopped: in the
   container, a one-off script in `/docker-entrypoint-initnuxeo.d/`, then `docker restart nuxeo`.
4. **Check,** once `http://localhost:8080/nuxeo/runningstatus` answers 200: the server log says
   `the DEPLOYMENT LAYER IS ON`; `GET /nuxeo/agentic-ui-apps/layer.json` answers an administrator
   `{ "format": "nuxeo-agentic-ui-layer/1", "apps": [] }` and anyone else 403; and the designer's
   panel shows the package's version of a file, with no live version and no draft.
5. **The demo** (phase 6, step 2): one administrator adds a field to the Claim record page, saves the
   draft and submits it; a second approves it; a claims adjuster opens a claim and sees the field.
   **Roll back** puts the package's page back.

**Removing it:** set `nuxeo.agentic.ui.layer.enabled=false` in `nuxeo.conf`, which on Docker is
`/etc/nuxeo/nuxeo.conf` as above, and restart: the packages' files are served again. The stored
layer stays in `/agentic-ui-layers` until an administrator deletes it.

### What a review must cover

- **Who may write and approve:** `LayerService.refusal` and `approvalRefusal`; that Nuxeo's
  administrators are the right people, that `selfApproval` stays off where there are two, and that
  a shared `Administrator` account, which makes two people one, is not used for it.
- **Server-side validation:** that `validator.js` is what `server-validator.ts` builds
  (`server-validator.spec.ts`), that Nashorn answers as Node does (`DeploymentValidatorParityTest`),
  and that the server's content model is the one the designer reads (`ServerContentModel`).
- **XSS through labels or layout strings:** the validator lets a label be any text, `<img onerror>`
  included (the parity corpus has one); the engines draw labels and a layout's strings through
  Angular's text binding, the panel draws versions as text (`layer-panel.spec.ts` checks one), and
  the registry answers JSON with `nosniff` and a `default-src 'none'` policy. **One HTML sink:** the
  `rich-text` widget draws a record's value, not the layout's, as HTML through the record page's
  sanitizer and its allow-list (`renderTrustedHtml`, `RICH_TEXT_HTML`), so a layer that gives a text
  property that widget changes how that property's values are drawn for everyone.
- **The rollback history:** 50 versions a file; that a rollback puts back only the version an
  approval replaced, or the package's file, and is never undone; a version no longer valid.
- **Drafts leaking to readers:** the registry's `live()`, the configuration servlet, the repository
  folder's ACL and its repair, and the REST API's reach into `/agentic-ui-layers`.
- **The layer's precedence** against the package and the manifest; and that a layer may add a
  layout or a queue the package has none of, which the validator holds as any other.
- **Audit:** the trail, the server log's lines and warnings, and Nuxeo's audit log, which records
  the service's writes as the system's and a direct write under its maker's name; whether an audit
  event under the administrator's name should be written too.
- **Concurrent edits:** revisions, the change token, the cluster's one lock, and the registry's copy
  of the live layer.

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

- **The deployment layer, not run on a server.** It is held by Java tests against fakes of the
  repository's session and by the client's tests, and has not been installed on one (above). Not
  built: an event in Nuxeo's audit log under the administrator's name, beyond the trail, the server
  log and the system's write of the document; restoring an older version at once, which goes
  through a draft; a layer per tenant (decision G); the labels, the menu, the home and
  the actions in a layer; a draft's review screen of its own, beyond the panel's differences; and an
  export of a published layer as a package. A layer layout reaches only the people in the app's
  groups with the app open: the record page of someone in no app's group keeps the package's.
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
  "not shown". Every Payers queue has one: `unassigned-claims` and `my-claims` are for
  `claims-adjusters`, and `pending-determination` for `claims-supervisors` and `member-services`.
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
  `lib-queue-page`, the server answered by `HttpTestingController`; both check that every request the
  engines make is a read. Each holds the deployment layer's panel as a stand-in, given the file open.
- `layer/layer-panel.spec.ts` holds the panel with a stand-in for its service: the three versions
  as text, a label that is markup drawn as text, each button following the server's permissions,
  the questions before approving, rolling back and discarding, and the server's refusals.
  `layer/deployment-layer.service.spec.ts` holds the requests: GET to read, POST of JSON with the
  change header to change, and each answer read. `layer/layer-state.spec.ts` holds the reading of
  the server's answers and the differences.
- **The server's half** is `nuxeo-agentic-core`'s tests, `mvn -pl nuxeo-agentic-core test`:
  `LayerServiceTest`, with the validator the server runs and the Payers kit, `LayerEndpointTest`,
  `DeploymentValidatorParityTest`, `NashornDeploymentValidatorTest`, `ServerContentModelTest`,
  `RepositoryLayerStoreTest` and `LayerSwitchTest`; and the record page's and forms' reading of a
  layer layout first is `libs/shared/document-layouts`' `layer-layout.spec.ts`.
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

  The third slice's, publishing, on the server: a non-administrator's write let through, an
  invalid file stored, a draft served by the registry, an approval by the draft's maker or
  submitter, a change on a stale revision, a change without its header, the switch on by default,
  a polyfill that differs from the library method it stands in for, the script given Java, the
  change token not passed to the repository, and the layer folder's ACL granting members; and in
  the client and the tools: the panel ignoring the approval permission, a change sent without its
  header, the record page not reading the layer first, the upgrade check not warning, and the
  committed script out of date.
