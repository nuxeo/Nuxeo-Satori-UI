# Controlled documents (demo)

The controlled documents starter kit's first slice, for phase 8 of the
[development plan](../../../docs/business-apps/development-plan.md): an engineering register whose
numbers, revisions and supersession are the server's, from
[`nuxeo-agentic-documents`](../../../nuxeo-agentic-documents/README.md), which the package depends
on. It shows demo step 3, "The new revision supersedes the old one". Every name in it is fictional.

## The short version

- **A record page** for an engineering document: its number, revision and status first, then what
  it is, the other revisions of its number, and its history. On a superseded revision, a banner
  above the cards says so and links to the revision that superseded it, by its title.
- **A queue of current documents:** each number's current revision, by number.
- **A home and a menu:** the current documents, which link to the queue, for everyone the app is
  for, and the superseded revisions counted for document controllers.
- **Two number series,** `DWG` for drawings, revised `A`, `B`, `C`, and `SPEC` for specifications
  and procedures, revised `1`, `2`, `3`, which the package registers with the add-on.
- **A stand-in model, in its own component:** the `EngineeringDocument` type, its `engdoc` schema,
  the add-on's `ControlledDocument` facet, and three page providers. Fictional, and replaced whole
  when a real one comes.
- **A seed script,** with its controls, which writes five documents, nine revisions in all, through
  the server's numbering alone. It creates no user and no group.
- **Not installed anywhere yet.** The package passes the pipeline; installing it with the add-on,
  and seeding it, are for the person who reviews it (below).

## What is in it

| File                                                                     | What it is                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `bundle/agentic-ui-config/app.json`                                      | The app: id and address `controlled-documents`, its name, version, platform range and two groups       |
| `bundle/agentic-ui-config/layouts/EngineeringDocument/view.layout.json`  | The record page: the superseded banner, the Control and Document cards, the revisions and the history  |
| `bundle/agentic-ui-config/queues/current.json`                           | The current documents queue                                                                            |
| `bundle/agentic-ui-config/home.json`, `navigation.json`                  | The home's two figures, and the menu                                                                   |
| `bundle/agentic-ui-config/labels/en.json`                                | Its labels, in English: every key the files above name                                                 |
| `bundle/OSGI-INF/controlled-documents-demo-config.xml`                   | The component that contributes the layout and the app                                                  |
| `bundle/OSGI-INF/controlled-documents-demo-model.xml`, `bundle/schemas/` | **The stand-in model:** the type, its schema and lifecycle, three page providers                       |
| `bundle/OSGI-INF/controlled-documents-demo-series.xml`                   | The two number series, for the add-on                                                                  |
| `content-model.json`                                                     | The model as the server would answer it, with the add-on's facet and schema, for the pipeline          |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/seed.selftest.mjs`               | The seed script, its fictional register, and its controls. Not packaged                                |
| `package/package.xml`                                                    | The Marketplace package: it depends on `nuxeo-agentic-ui` 2026.0.2 and `nuxeo-agentic-documents` 0.1.0 |
| `build.mjs`                                                              | Version 1's builder: the generator's, byte for byte                                                    |

One version in three places: 0.1.0, in `package.xml`, `app.json`'s `packageVersion` and the
manifest's `Bundle-Version`.

## The record page

| Card                     | Shows                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `superseded` banner  | Only while `docctl:status` is `superseded`: "This revision is superseded. Work from the current revision:", and the successor's title, which opens it                   |
| Control                  | Number, revision, status as a badge (`current` positive, `superseded` warning), series, and the revisions it supersedes and is superseded by, each by its title, linked |
| Document                 | Title, category, discipline, project, issued for, originator (by name), issued on, description                                                                          |
| Revisions of this number | Every live revision with this one's number, newest first, from `controlled_documents_revisions`                                                                         |
| History                  | The record's audit                                                                                                                                                      |

**The banner's link is a small addition to layout version 2,** since a banner held text only: a
banner may name, in `link`, a property of the open record that holds a record's id, and the page
shows that record by its title, as a `document-link` field does, as the banner's one action, which
opens it ([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 2). The validator holds
the link to a property of the type, and to one text, given the content model; a record the reader
may not read shows "Unavailable", disabled; the layout designer's read-only preview shows it
disabled. The Control card's `docctl:supersededBy` field says the same thing again, for a reader who
scrolled past the banner.

**Nothing on the page is a control.** The banner and the badge read `docctl:status`, which the
server writes. Whether anyone may read a revision, or write one, is the server's permissions'.

## The stand-in model

| Type                  | Schemas (prefix)                                                                              | Facet                | What its own schema holds                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `EngineeringDocument` | `common`, `dublincore`, `engdoc` (`engdoc`), and the facet's `controlled_document` (`docctl`) | `ControlledDocument` | `discipline`, `category`, `project`, `originator`, `purpose`, `issuedOn`. Its title is `dc:title` |

- **The `docctl:` properties are the add-on's,** and the server's to write: a new document names
  its series, or the revision it supersedes, and nothing else.
- **Not a folder, and holds no file,** so a document opens as a record page. A real register's
  drawings carry their files; the stand-in leaves them out, as its demo is about the register.
- **No folder lists the type among its subtypes,** so the Create menu does not offer it: the seed
  writes the records. A create form naming the series, and one naming the revision a new one
  supersedes, are not built.

| Page provider                     | Given    | Returns                                       |
| --------------------------------- | -------- | --------------------------------------------- |
| `controlled_documents_current`    | Nothing  | Current revisions, by number                  |
| `controlled_documents_superseded` | Nothing  | Superseded revisions, latest change first     |
| `controlled_documents_revisions`  | A number | Every revision with that number, newest first |

Each reads the repository, so it lists a write at once; none has an aggregate; each leaves out
versions, proxies and trashed records. `content-model.json` describes the type as a server with both
packages installed would answer: `common` and `dublincore` as the generator wrote them, and the
type, its schema and the add-on's facet in the export's shape, since no server has them yet.

## How it was built

In a checkout of `staging/enterprise-grade-app`, on Node 24.22.1, with the generators, then by hand
where they stop:

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

## Checking it

| Check                                                                                      | Result                                                                                                 |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `npm run app-package -- business-apps/packages/controlled-documents-demo --platform 0.2.0` | Passed: 6 files, the layout held to the package's own `content-model.json`, the zip built and verified |
| The same, the banner's link broken four ways, one at a time                                | Each refused at step 2: a property the type lacks, a date property, `ecm:uuid`, a key the format lacks |
| `node business-apps/packages/controlled-documents-demo/demo/seed.selftest.mjs`             | 22 of 22 controls passed. Broken on purpose seven ways, one at a time, each turned a control red       |

**Not seen on a server or in a browser.** No server has the add-on or the kit, so the record page
has not been drawn with them: what shows the banner's link, its unavailable and read-only states
and its one request is `record-page.spec.ts`, on the platform's own record page component.

The seed's seven breakages: a number of its own written on creation; a `docctl:` property written
on an update; a chain continued over someone else's supersession; two chains sharing a number not
seen; the page providers not asked; the password printed; a refused sign-in taken for no
precondition.

## Installing it on a local Nuxeo

**Not run.** With the add-on, in one restart, as
[its README](../../../nuxeo-agentic-documents/README.md#installing-it-on-a-local-nuxeo) says. Then,
with `NUXEO_USER` and `NUXEO_PASS` exported for an account that may create a workspace:

```bash
node business-apps/packages/controlled-documents-demo/demo/seed.mjs
```

It prints the home, the queue, a superseded revision and its current one. The kit's groups,
`document-controllers` and `engineers`, are the server's to create: the app is served to people in
them.

## Running the demo: step 3

1. **The register:** the home's "Current documents" opens the queue: five numbers, each at its
   current revision, `DWG-…` revised `C`, `B` and `A`, `SPEC-…` revised `2` and `1`.
2. **A superseded revision:** the seed's link to the pump house drawing's revision A. The banner
   says it is superseded, with revision B's title; the Control card says `superseded`, superseded by
   revision B; the revisions card lists A, B and C.
3. **The new revision supersedes the old one,** live: create a revision D over C through the REST
   API, as a person who may write C:

   ```bash
   curl -s --fail-with-body -u "$NUXEO_USER:$NUXEO_PASS" -H 'Content-Type: application/json' \
     -X POST http://localhost:8080/nuxeo/api/v1/path/default-domain/workspaces/controlled-documents-demo/register \
     -d '{"entity-type":"document","type":"EngineeringDocument","name":"pump-house-ga-d","properties":{"dc:title":"Pump house general arrangement, revision D","docctl:supersedes":"<C'\''s id>"}}'
   ```

   The answer has C's number and revision `D`; C's page now shows the banner, linking to D; the
   queue shows D in C's place. The same request as a person who may read C but not write it is
   refused, 403, and nothing is created.

## Not done yet

- **Installed anywhere, or seeded:** waiting on the orchestrator, after the add-on's security
  review.
- **A create form,** naming the series, and one for a new revision, naming the one it supersedes,
  so that step 3 runs in the app rather than through the REST API: a button that runs an operation
  waits on decision 3, and a form needs no operation.
- **Transmittals, review cycles, export-control marks and outside users** (decision C), the rest of
  phase 8's document control.
- **Files.** The stand-in type holds none; a real register's revisions carry their drawings.
