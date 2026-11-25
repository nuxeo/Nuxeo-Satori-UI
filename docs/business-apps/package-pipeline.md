# The package pipeline: its first stage

Phase 0 of the [development plan](development-plan.md) builds the package pipeline's first stage:
validate, sign, publish to pre-production. Phase 3 completes it, with versions, signatures and
promotion after a person approves.

Status: built on 22 November 2026, and not yet run in full. The checks run on every pull request;
signing and publishing run only for a tag, and no tag has been pushed yet. Versions were added on
23 November 2026 (section 8); signatures and promotion after approval are a proposal (section 9).

## The short version

- **Checked on every pull request, with Node and `unzip` alone.** A package that names a widget
  the platform does not have fails, and the log names the file, the place and the widget.
- **Signed and published only when someone tags it.** The tag goes on a merged commit, and the
  package goes to Nuxeo Marketplace preprod, as the platform's own package does.
- **A package's own code never runs where the secrets are.** The job that holds them only checks,
  signs and publishes the zip the first job built.
- **Held to a content model.** With `--model`, a model file exported from a server, a layout whose
  widget does not show its property's type is refused, and so is a field whose property the type
  does not have. Given none, a package that ships a stand-in model, as the kits do, is held to its
  own `content-model.json`, in CI too; a package on a customer's model, given none, passes these
  (section 4).
- **Every label key has a text,** in the package's `labels/en.json` or in the platform's English
  catalogue. One with neither is refused, by its key and its file.
- **A facet names an aggregate its page provider defines,** when the package's own model defines
  that page provider; so does a home's figure. Only the search index answers aggregates, and a facet
  on anything else is left out of the queue, said only in the browser's console.
- **Its version is held to what changed.** Given the package as it was, a version that did not move
  when the content changed is refused, and so is one that moved less than the changes need: a
  queue removed needs a major. Each build writes what changed beside the zip (section 8).
- **Every kit at once, as a release candidate.** One command builds the client, the server
  packages and every kit, and refuses a set that does not hold together: a dependency Nuxeo would
  not count as met, two kits contributing the same name, a kit whose version did not move since the
  last release. It runs offline on every push to a staging branch (section 11).

## 1. What an app definition package is

It is a configuration package, as version 1 builds them
([extension-reference.md](../extension-reference.md), section 1): `bundle/`, `package/` and the
generator's `build.mjs`. What is new is in `bundle/agentic-ui-config/`, the app definition's
root: `app.json`, and the other files of [app-definition-v2.md](app-definition-v2.md), section 1.

- **What a server reads from it:** its layouts, which the component XML contributes as version 1's
  are, and its app, which the component contributes to the app registry in `nuxeo-agentic-core`,
  phase 0's: an `<app id src>` element naming its `app.json`, with a `<file path>` for each other
  file of the app definition the registry serves (app-definition-v2.md, section 10). A version 2
  layout sits where version 1's does, and its view mode is new, so an app that reads only version 1
  never asks for it. The registry serves the app after sign-in, to the groups its `app.json` names.
- **What it carries for later:** `modules/`, which the registry does not serve until a domain
  module exists, and `actions.json`, which the registry serves and nothing in the app reads yet.
- **No bootstrap fragment.** On a server that runs several apps, a bootstrap fragment would
  rebrand every one of them. An app's branding is in its `app.json`. The pipeline does not check
  this yet.

The demo is [`business-apps/packages/payers-claims-demo`](../../business-apps/packages/payers-claims-demo/README.md),
with fictional data. It is also phase 1's Payers kit, version 0, so its bundle carries a second
component: a stand-in content model, with its document types, schemas and page providers, until
the presales Payers model replaces it. Since 0.4.0 a third contributes phase 2's claims review
workflow: a route model, as a zip the bundle carries, with its variable schemas and chains. The
builder holds its XML to what Nuxeo can load, as it does every component's; nothing in the pipeline
checks the schemas, types, page providers or route model themselves, nor that a layout's page
provider exists. The one thing step 2 reads in a page provider the package defines is the
aggregates it lists, which a queue's facets and a home's figures must name (section 2). The kit's
own controls check its route model
([its README](../../business-apps/packages/payers-claims-demo/README.md)).

## 2. The steps

`scripts/app-package.mjs` runs steps 1 to 6 on one package, each stopping the run when it fails.
It first removes the zip and checksum an earlier run left for the package's name and version, so
a refused package leaves nothing installable behind, not even an older zip that looks current. The
one exception is a `package.xml` that is a symbolic link, whose name is not read (below).
The workflow, [`app-packages.yml`](../../.github/workflows/app-packages.yml), runs it on every
package, and runs steps 7 and 8 for a tag.

| Step              | What is checked or done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The builder    | Nothing in the package is a symbolic link, and its `build.mjs` is the generator's, byte for byte, so the code that builds it is code this repository reviewed. A `package/install.xml` that is a folder is refused here, since no step before the builder reads it                                                                                                                                                                                                                                                                       |
| 2. The definition | `bundle/agentic-ui-config/` has an `app.json`, and the validator finds nothing, given the deployment's allow-list, what it registers, its platform version, the platform's English catalogue, and a content model: the one given, or a stand-in package's own (section 4). Every label key has a text; a facet or a figure on the package's own page provider names an aggregate it defines; the layouts the component contributes are the ones the validator read, and so is the app it contributes to the app registry, with its files |
| 3. The version    | `app.json`'s `packageVersion` and the manifest's `Bundle-Version` are `package.xml`'s version, and the tag, when publishing, is `app-package/<name>/<version>`. Given the package as it was, `--previous`, the version moved as far as the changes need (section 8)                                                                                                                                                                                                                                                                      |
| 4. The build      | `build.mjs` writes the zip, refusing what the server would refuse                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5. The zip        | `verify-package-zip.mjs` finds a well-formed Nuxeo Package. A zip it refuses is removed                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6. The checksum   | The zip's SHA-256, beside it, in the form `sha256sum -c` reads. The build is reproducible, so the same source gives the same digest. Given `--previous`, the changelog beside it too, `<name>-<version>.changes.md`                                                                                                                                                                                                                                                                                                                      |
| 7. Signed         | A build provenance attestation: GitHub's Sigstore attests that this repository's workflow built this zip from this commit                                                                                                                                                                                                                                                                                                                                                                                                                |
| 8. Published      | Nuxeo Marketplace preprod, through the same `nos-publish` step `build-marketplace.yml` uses                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Steps 1 to 6 need no install and no credential, only Node 24, as `.nvmrc` pins, and the system's
`unzip`, which step 5 reads the zip back with. The one exception is opt in: a content model read
live from a server needs that server's credentials (section 4). The validator runs from its TypeScript through
`libs/shared/app-definition/src/bin.mjs`. The XML of `package.xml` and of the component is read by
`verify-package-zip.mjs`'s helpers, the builder's own grammar, ported.

Step 2 also holds the component to what the validator read: every layout it contributes comes from
`agentic-ui-config/layouts/<Type>/<mode>.layout.json`, in the mode its path names. One written
inline, or contributed from another file or in another mode, is refused, because the server serves
what the component says. The other way round as well: a file under `agentic-ui-config/layouts/`
that no enabled `<layout>` entry contributes is refused, with the entry that would contribute it,
since the validator passed it and the server would never serve it. So is one that only a disabled
entry names, or only an entry outside an extension of the configuration's point, where nothing
registers it, and a file there at no layout's place. A Markdown file there is not packaged, and is
let be. It finds the components as the builder, the verifier and the server do:
the `Nuxeo-Component` headers of the manifest's main section, in any letter case, and it checks
those of every such header. A manifest that names them in more than one header, or spells the
header another way, is the builder's to refuse, at step 4: the server would load only the last. A
component path must also stay in `bundle/`: one that climbs out with `..`, is absolute, or names a
folder or a hard link is refused before it is read. Read, a component outside the package would
have its layout attributes quoted back from wherever it is. A component that is missing is the
builder's to refuse. A manifest that is a folder is refused at step 2 too, rather than read.

Step 2 gives every label key a package names a text. The validator collects each `labelKey`, in
every file of the app definition but the labels themselves and a module's settings, and looks it up
as the app does (app-definition-v2.md, section 7): in the package's `labels/en.json`, then in the
platform's English catalogue, `apps/nuxeo-ui/public/i18n/en.json`, its nested keys joined with
dots. A key with a text in neither is a finding, with the key, the file and the place: on a page, a
card would show its id made readable, and a field its property's name. Only English is checked,
the language every other falls back to. The validator checks keys only when it is given the
catalogue, `--catalogue`, which the pipeline always gives.

Step 2 holds a queue's facets, and a home's figures, to the page providers the package defines. A
facet is one of its page provider's aggregates, and only a page provider of the search index
answers aggregates, and only those its definition lists: on any other, the queue leaves the facet
out and the home's figure reads "Unavailable", each said only in the browser's console. So for a
page provider that a component the manifest names defines, in an extension of
`org.nuxeo.ecm.platform.query.api.PageProviderService`'s `providers` point, each facet's
`aggregate`, and each figure's `kpi.aggregate`, must be the `id` of one of its `<aggregate>`
entries. One that is not is a finding in the validator's form, naming the file, the place, the
page provider, the component and the aggregates it does define; a `coreQueryPageProvider` with
none is said to read the repository, and `app-model --aggregates` writes the indexed kind. A page
provider the package does not define is the server's, which the pipeline does not read, and its
facets are not checked; nor are those of one whose only definition is disabled.

Step 2 holds the app the component contributes to the same files. The package contributes its app
once, under the id its `app.json` gives, from `agentic-ui-config/app.json`, the file the validator
read, and names exactly the files of the app definition that the registry serves: `home.json`,
`navigation.json`, `actions.json`, `queues/<id>.json`, `labels/<lang>.json` and
`tasks/<workflow>.<step>.layout.json`. A file the package holds and does not name would never be
served; one it names and does not hold would be missing on the server; one at another place, such
as a layout, is not the registry's to serve. Each is refused, and so is a second app, a package
being one app. A package that contributes none is built, with a note that the registry will not
serve it: the generators write the contribution (`app-package`, and `app-registry` for a package
without one), and whether to refuse a package without it is still to decide. A disabled `<app>`
contributes nothing. The selftest breaks the demo's contribution in each of these ways.

Nothing in a package is read through a symbolic link. Step 1 searches the package for one before
any step reads a file, and refuses it: a link can point anywhere, a linked `build.mjs` would have
steps 1 and 4 use a builder from elsewhere, and what a step reads it may quote back. The builder
refuses a link in `bundle/` or `package/` too, at step 4. A `package.xml` that is a link is not read
even to clear an earlier run's zip, so that zip stays. The content model `--model` names is the operator's input, not the
package's, and is read wherever it is (section 4); kept in the package's folder, as the demo's is,
it must not be a link either.

## 3. Running it

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0
```

It writes `dist/payers-claims-demo-0.4.0.zip` and its `.sha256` in the package. `--out` puts them
elsewhere. `--allow-list` and `--registered` pass the deployment's to the validator. `--model`
and `--model-server` give it the server's content model (section 4). `--previous` gives it the
package as it was, to hold its version to (section 8).

`--platform` is the version of the platform the package is to run on, which `app.json`'s
`platform` range must hold. It is the `version` of `libs/platform/package.json`, the platform's
own package, and nothing else in the repository says it:

```bash
node -p "require('./libs/platform/package.json').version"
```

The workflow passes that, and so does the Builder MCP server's `validate_package`. The commands on
this page give `0.2.0`, the version when they were written: give yours. Left out, the range is not
checked.

Its negative controls break a copy of the demo package in one way each, and every one must be
refused at its own step, for its own reason, with no zip left:

```bash
npm run app-package:selftest
```

## 4. The content model

The validator checks a layout against itself and the registries. Only a content model says what
each document type's properties are, so the pipeline holds layouts to one only when it has one
([layout-v2.md](layout-v2.md), sections 3 and 11): the file `--model` names, the server
`--model-server` reads, or, given neither, the package's own stand-in, below.

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0 \
  --model business-apps/packages/payers-claims-demo/content-model.json
```

- **What is refused,** in each layout, against the type its path names,
  `layouts/<Type>/<mode>.layout.json`:
  - a field whose property is on neither the type nor a facet the type declares;
  - a widget that does not show its property's type, as the widget's `accepts` says: `date` on a
    text, `text` on a list;
  - a table column naming a subfield its property does not have, or whose widget does not show the
    subfield, and an address part naming a subfield the property does not have;
  - a layout for a type the model does not have.
- **Version 1 layouts are not held to it**, as they are not validated. The run says how many
  layouts it held to the model, and says so when there were none.
- **The model file** is `{ doctypes, facets, schemas }`: the `doctypes` of `/api/v1/config/types`,
  `/api/v1/config/facets`, and each schema of `/api/v1/config/schemas`. It has the shape of
  `NuxeoContentModel` in `libs/shared/nuxeo-client`. Export one from a server, with its credentials
  from the environment:

  ```bash
  NUXEO_USER=<user> NUXEO_PASS=<password> \
    npm run app-package:model -- --server https://<host>/nuxeo --out content-model.json
  ```

  It reads each schema on its own, `/api/v1/config/schemas/<name>` with `fetch-schema: fields`,
  because the list leaves out every field's constraints, and with them the directory a property is
  bound to. It then reads the file back as `--model` does, and removes it, exiting 1, when it
  cannot be read whole.

- **Read live instead:** `--model-server https://<host>/nuxeo`, with `NUXEO_USER` and `NUXEO_PASS`
  in the environment, reads the same model before step 1. A model that cannot be read stops the
  run with exit 2 before any step, once the zip an earlier run left is removed: the package is
  neither refused nor built on a model nobody saw.
- **The credentials** go in an `Authorization` header and nowhere else: an address that carries
  them is refused, so is plain HTTP to another machine, and a redirect is not followed.
- **A package's own model, by default.** Given neither `--model` nor `--model-server`, a package
  that ships a stand-in model, a component of its own that registers document types, as
  `app-model` writes it, is held to the `content-model.json` beside its `bundle/`, which describes
  that model, and the run says so first, in a line that begins
  `The content model is the package's own content-model.json`. So CI and `validate_package`,
  which pass no model, refuse a demo kit's misspelt property too. A `content-model.json` with no
  stand-in model behind it describes a server, which may have changed since, and is not used
  unless `--model` names it; a package on a customer's model is held to no model unless it is
  given one. So is a package whose only document types are `append="true"`, which add to the
  server's. The package's own file that cannot be read as a content model refuses the package at
  step 2, since it is the package's, not the command's.
- **The demo's model,** `content-model.json` beside the package, is the kit's stand-in model as a
  local Nuxeo with the package installed answers it, exported with `app-package:model` and cut down
  to the kit's five types, their facets and their schemas. All four record pages pass against it.
  The negative controls hold the demo to it: a widget that does not fit, a property the type does
  not have, an address part naming a missing subfield, and a type the model does not have are each
  refused at step 2 with `--model`, and the first two without it too, by the kit's own model. The
  same broken layout in a copy with no `content-model.json`, or whose components register no type
  or only append to the server's, is built, which shows that it is the model that refuses it. A
  `--model` file that cannot be read, and a server that refuses a read, each exit 2; the package's
  own `content-model.json` that cannot be read is refused at step 2, as the package's defect. A fake
  server answering as Nuxeo does proves the live read and the export: the credentials arrive on
  every read, each schema is read with `fetch-schema: fields`, a model whose property the widget
  does not fit refuses the layout, and the exported file is the model the server answered. Run
  against a local Nuxeo server, the export read 60 types, 65 facets and 98 schemas, with the
  directories bound to `dc:coverage` and to each item of `dc:subjects`.

## 5. Publishing a package

1. Raise the version in `package/package.xml`, `app.json`'s `packageVersion` and the manifest's
   `Bundle-Version`, together, as far as section 8 says the changes need, and merge. The pull
   request's check refuses less.
2. Tag the merged commit `app-package/<name>/<version>`, and push the tag.
3. The workflow checks and builds the package again at that commit, held to its last release,
   signs the zip and publishes it, with what changed since in the run's summary.
4. Anyone can check the signature:

   ```bash
   gh attestation verify payers-claims-demo-0.3.0.zip --repo nuxeo/Nuxeo-Satori-UI
   ```

A tag rather than a button: a manually dispatched workflow must be on `main`, which this one
reaches only when the integration branch does, and a tag names exactly what is published.

## 6. Phase 0's demo, steps 1 and 2

1. In a pull request, change a widget of the demo's layout to `calendar`. The check fails, and
   its log names the layout file and then
   `cards[0].fields[1].widget: the widget "calendar" is not registered [unknown]`.
2. Put it back. The check passes, and tagging the merged commit publishes the package to preprod.

## 7. Not settled here

- **Signing** is a proposal for the security owners: an attestation is keyless, and anyone can
  check it. Section 9 proposes how phase 3 completes it; nothing of it is built.
- **The first publish of a new package name** may need it registered on Nuxeo Connect's staging
  environment first. Not checked.
- **Who may publish:** anyone who can push a tag. A ruleset can restrict `app-package/*` tags, and
  none does yet.
- **Promotion to production after a person approves:** proposed in section 9, a GitHub
  environment with required reviewers; not built. Versions are section 8's.
- **The allow-list** is the deployment's (decision 3). Until it exists, the workflow passes none,
  and every operation is refused.
- **Where kits live:** under `business-apps/packages/` for now. Version 1's configuration packages
  moved to nuxeo/Nuxeo-Satori-Config; whether kits follow them, calling this pipeline from there,
  is open.
- **Not exercised yet:** steps 7 and 8, which run only for a tag.
- **The workflow passes no server's content model.** A kit that ships a stand-in model is held to
  its own `content-model.json` on every pull request (section 4). A package on a customer's model
  is held to none there: whether such packages commit their server's model, and where, is open.
- **A facet on the server's page provider.** The pipeline reads no server, so a facet whose page
  provider the package does not define is not checked: `describe_page_provider` lists a server's
  aggregates. Nor is an aggregate's type, a terms aggregate on a date, say.
- **Label keys in other languages.** A key with an English text passes; one missing from
  `labels/fr.json` falls back to English, and is not refused.
- **A facet a record gains at run time.** A field whose property only such a facet brings is
  refused when a model is given, and the message names the facet. The record page shows it on a
  record that has the facet. Whether the pipeline should accept it, perhaps when a rule shows the
  field only on records with that facet, is open.
- **Not held to the model yet:** a related list's columns, which are other records'; a queue's
  columns; the properties a computation, a rule or a widget parameter names; a task form's fields;
  and a vocabulary widget's `directory` against the one its property is bound to.

## 8. Versions

Phase 3 completes the pipeline with versions. A package's version is `package.xml`'s, which
`app.json`'s `packageVersion` repeats (step 3), and it is a semantic version, read for an app
definition this way: **a version says what someone relying on the package can still rely on**,
another package layered on it, a link someone kept, the people it is for and the servers it runs
on. It does not measure how much changed.

| Change                                                                                                                                                                                                                                                                                              | From 1.0.0                                                    | Below 1.0.0                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| **Breaking:** a layout, a queue, a task form, a labels language or one of its keys, an action, a module's settings, the home, the menu or an image removed; the app's `address` changed; a group losing the app; the platform range leaving out a release it admitted; a domain module newly needed | major                                                         | minor                               |
| **Addition:** any of those added; a group given the app; the platform range admitting more                                                                                                                                                                                                          | minor                                                         | patch                               |
| **To judge:** a change outside the app definition, such as the component that contributes it, a schema, the stand-in model, `package.xml`'s dependencies or `install.xml`                                                                                                                           | minor, and a person raises the major when it breaks something | patch, and the minor when it breaks |
| **Change:** anything else in a file that stays: a card, a field, a column, a rule, a label's text, the branding, or the same file with its keys in another order                                                                                                                                    | patch                                                         | patch                               |

- **Below 1.0.0, everything moves down one,** as npm reads `^0.y.z`, and as `app.json`'s platform
  range is read ([app-definition-v2.md](app-definition-v2.md), section 3).
- **Raising more is allowed.** A large redesign may be a minor. The pipeline refuses less than the
  changes need, never more.
- **The version is written in three places, and is not a change.** Step 3 refuses a manifest's
  `Bundle-Version` that is not `package.xml`'s version, as it refuses an `app.json` whose
  `packageVersion` is not. The comparison leaves all three out: a version raised in the three
  with nothing else changed passes, and its changelog says so.
- **An app keeps its id, and a package its name.** A changed one is another app or package, not a
  new version, and is refused.
- **A prerelease carries what its release may.** `1.0.1-rc.2` is on the way to 1.0.1, a patch, so
  from `1.0.1-rc.1` it may carry a change and nothing more; a breaking change needs `2.0.0` or one
  of its prereleases. `1.0.0`'s prereleases are on the way to a major, and may break. Otherwise a
  breaking change could reach a patch release one prerelease at a time.
- **Content is what the zip holds,** as the builder writes it: every file of `bundle/` but its
  Markdown, and `package.xml` and `install.xml`. A JSON file is compared as the builder packages
  it, parsed and written again without its `$schema`, so its spacing is not content and the order
  of its keys is; the manifest with its lines unfolded. An image is compared by its bytes.
- **Not weighed:** what a file says beyond the names above, so a field removed from a record page
  is a change, since nothing outside the package can name a field; which prereleases a platform
  range admits; and `build.mjs`, which is the generator's, byte for byte.

### Holding a package to them

Given the package as it was, `--previous <package directory>`, step 3 compares the two with the
validator's `changes` command (`libs/shared/app-definition/src/lib/changes.ts`) and refuses, each
time listing the changes:

- a version that did not move when the content changed: _the content changed since 0.2.0 (1
  change), and the version is still 0.2.0. Raise it to 0.3.0 at least, a minor version_;
- a version that moved less than the changes need: _the changes since 0.2.0 need a minor version
  (below 1.0.0, a breaking change raises the minor, and anything else the patch), and 0.2.1 raises
  the patch. For one: The queue unassigned-claims is removed_;
- a version lower than the previous one, and a changed app id or package name.

A package that passes gets its changelog beside the zip, `<name>-<version>.changes.md`:

```markdown
# payers-claims-demo 0.3.0

Since 0.2.0: 1 change, which needs a minor version. 0.3.0 raises the minor.

## Breaking

- The queue unassigned-claims is removed: a link to it, a menu entry or a home card naming it stops working.
```

By hand, against the staging branch's copy:

```bash
mkdir -p /tmp/base
git archive origin/staging/enterprise-grade-app business-apps/packages/payers-claims-demo | tar -x -C /tmp/base
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0 \
  --previous /tmp/base/business-apps/packages/payers-claims-demo
```

**In CI,** `app-packages.yml` holds a pull request to its base, a push to the commit before it, and
a tag to the package's last release below it, skipping prereleases, so a release's changelog and
its judgement cover everything since the release before it, whatever prereleases came between. A
package the base does not have is new, and held to nothing. The changelog goes into the
job's summary and the artifact. The base is fetched by its commit, at depth 1, with the checkout's
anonymous access, which a public repository allows; a private one would need the job's token for
that fetch.

**Its controls:** `npm run app-package:selftest` refuses a `Bundle-Version` apart from the
package's version at step 3, and breaks the demo once per version rule, 14 times, each
refused at step 3 for its own reason with no zip and no changelog left, an earlier run's changelog
included; builds 8 sound ones with the changelog each should have, among them a Markdown file and
a re-spaced JSON file that change nothing the zip holds; and checks that a `--previous` that is
not there stops the run, exit 2. The library's spec holds each rule's classification and
judgement. The workflow's step was run on a scratch clone: a pull request that changes nothing
(built), one that removes a queue at the same version (refused), a tag 0.9.1 whose queue was
removed in 0.9.1-rc.1, held to 0.9.0 and refused, and a tag 0.10.0, held to 0.9.1, not to
0.10.0-rc.1. It has not run on GitHub yet.

**Not yet:** `validate_package`, in the Builder MCP server, takes no previous package, so an agent
learns that a version must move only from the pipeline.

## 9. Signatures and promotion after approval: a proposal

Status: proposal, 23 November 2026, for the security owners and the user. **Nothing here is
built**: no key, tag, secret, environment or ruleset was created, nothing was published, and the
workflow's publishing job is as section 5 describes it.

**Where it starts.** A tag `app-package/<name>/<version>` has `sign-and-publish` attest the zip,
through GitHub's `actions/attest-build-provenance`, and publish it to Marketplace preprod. Nobody
approves anything between the tag and preprod, nothing checks the attestation once it is made, and
there is no production step.

### 9.1 Signing

Proposed: **keep keyless signing, and check the signature where it matters,** rather than add a
key.

- **The tool:** GitHub's artifact attestations, which the workflow already makes: a build
  provenance statement, signed through Sigstore, naming the zip's SHA-256, this repository, the
  workflow file, the commit and the tag. `gh attestation verify` checks one; `cosign
verify-blob-attestation` does too, for someone without the GitHub CLI.
- **Where the keys live: nowhere this team keeps one.** Each run gets a certificate that lasts
  minutes, issued by Sigstore to the workflow's OIDC identity, and the signature is recorded in
  Sigstore's public transparency log. There is no private key to store, rotate, leak or revoke.
  What must be protected instead is who can make the workflow run for a tag (9.2, "Who may start
  it").
- **What a check holds the zip to,** beyond "this repository built it": the workflow file and the
  tag. With the GitHub CLI's flags for them, to be confirmed on the version CI uses:

  ```bash
  gh attestation verify payers-claims-demo-0.3.0.zip --repo nuxeo/Nuxeo-Satori-UI \
    --signer-workflow nuxeo/Nuxeo-Satori-UI/.github/workflows/app-packages.yml \
    --source-ref refs/tags/app-package/payers-claims-demo/0.3.0
  ```

- **Where it is checked:**
  1. in `sign-and-publish`, just after the attestation and before publishing, so a wrong one is
     found before anything is public;
  2. in the promotion job (9.2), before production, so the zip promoted is the one attested;
  3. at install, by the deployment's own install script, before `nuxeoctl mp-install`. Whether
     Nuxeo's package manager, or the app registry, could check one itself is the platform team's
     question; not checked here.
- **A server that cannot reach Sigstore** can be checked offline, with the attestation downloaded
  beside the zip and Sigstore's trusted root exported once (`gh attestation download`,
  `gh attestation trusted-root`, then `--bundle` and `--custom-trusted-root`). To be tried on the
  CLI version in use.
- **If a key the team holds is required:** cosign with a key in a cloud KMS, reached from the
  workflow through OIDC federation, so no long-lived secret sits in GitHub and the key never
  leaves the KMS. The cost: a key to rotate and revoke, a public key every verifier needs, and an
  account in a cloud. Proposed only if a customer's policy asks for a vendor-held key.
- **What a signature does not prove:** that the package is right, or approved. That is review
  and promotion.

### 9.2 Promotion after a person approves

Proposed: **build once, publish to preprod on the tag, and promote the same bytes to production
once a named person approves, in a GitHub environment.**

```text
tag app-package/<name>/<version>
  check             builds and verifies the zip, its checksum and its changelog, and uploads them
  sign-and-publish  checks the checksum, attests, checks the attestation, publishes to preprod
  promote           environment app-packages-production: waits for an approval, then takes the
                    same artifact, checks the checksum and the attestation, publishes to production
```

- **The approval is a GitHub environment,** say `app-packages-production`, with required
  reviewers, a team rather than one person, and "Prevent self-review" on, so whoever pushed the
  tag cannot approve it; and with its deployments limited to `app-package/*` tags, so no branch can
  reach it.
- **Its secrets are its own.** The production Marketplace credentials would be environment
  secrets of `app-packages-production`, which a job reads only once approved. Today's
  `CONNECT_PREPROD_*` would move to an `app-packages-preprod` environment the same way.
- **What the approver sees,** in the run's summary: the changelog since the last release (section
  8), the part the version needed and the part it raised, the zip's digest, the attestation, and
  the preprod install to try. Approving says that these bytes, tried in preprod, go to production.
- **The same bytes.** The promotion job never builds: it takes the artifact of the same run, as
  `sign-and-publish` does. GitHub expires a job waiting for approval after 30 days, and the
  artifact is kept 30 days (`retention-days`), so the two must stay aligned.
- **The record:** GitHub keeps each deployment, who approved it and when; the tag names the
  commit, and the attestation the run.
- **Who may start it:** a ruleset restricting who may create `app-package/*` tags (section 7
  notes that none does). Without one, anyone who can push starts the chain, and the approval still
  stops it short of production.
- **Rolling back** is publishing a higher version with the earlier content: a version is never
  published twice. Removing what a version added is a breaking change, and section 8 asks for its
  raise.

### 9.3 What the user decides

1. Keyless signing, or a key in a KMS, and the verification policy: which workflow and which refs.
2. Whether installs check the signature, and where.
3. The environments' names, their reviewers, and whether preprod also waits for an approval.
4. Production's Marketplace target and credentials, which the `nos-publish` step takes as it takes
   preprod's (the name of its production environment is not checked here).
5. The ruleset for `app-package/*` tags.

## 11. A release candidate across all kits

Phase 10's first demo is a release-candidate tour across every kit
([development plan](development-plan.md), phase 10). `scripts/release-candidate.mjs` assembles the
candidate that tour would install, offline: no Nuxeo server, no credential, no signature, no tag and
no publishing. Built on 25 November 2026; it has not run on GitHub yet, only on a laptop.

```bash
npm run release-candidate -- --out ../release-candidate-2026.0.2 --since origin/main
```

- **`--out`** is a directory that does not exist yet, and not one under `business-apps/packages/`,
  where it would be read as a kit. A candidate never overwrites an earlier one: an existing path,
  folder or file, stops the run with exit 2 and is left as it was. A refused run removes the
  directory it made, so no half-built candidate looks like a whole one.
- **`--since`** is the last release, any git ref: each kit is held to itself as that commit has it.
  A kit the commit does not have is new, and held to nothing; one it has that the candidate does
  not is listed as removed.
- **`--version`** is the version of the server packages. Left out, it is the root pom's without
  `-SNAPSHOT`: a release candidate carries the version it would be released as, because Nuxeo
  counts neither `2026.0.2-SNAPSHOT` nor `2026.0.2-rc.1` as meeting a kit's dependency on
  `nuxeo-agentic-ui:2026.0.2` (below).
- It needs Node 24, Maven with a JDK, `unzip`, git and an installed workspace (`npm ci`). It takes
  about four minutes on a laptop, most of them the client's production build. It has not been run on
  Windows, where Maven is a `.cmd` that Node starts only through a shell.

### What it builds and checks

Each stage stops the run when it refuses, with exit 1.

| Stage                    | What is built, and what is refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2. Every kit             | Each folder under `business-apps/packages/`, through this pipeline's steps 1 to 6, with the platform version of `libs/platform` and `--previous` the kit at `--since`. So a kit whose platform range leaves the candidate's platform out is refused at step 2, and one whose version did not move as far as its changes need at step 3                                                                                                                                                                                         |
| 3. The kits as a set     | Read from the zips: no two kits contribute the same package name, app id, address (the id, for an app with none), queue, action, component, document type, facet, schema, lifecycle, a type's lifecycle, page provider, automation chain or scripted operation, directory, action filter, workflow, event listener, or layout of a type and mode. A server keeps one of each: the later replaces the earlier, or is refused. An extension point the check does not know is printed and written to the manifest as not compared |
| 4. The client            | `nx build nuxeo-ui --configuration=production --base-href=/nuxeo/agentic-ui/`, as `build-marketplace.yml` builds it, without Nx's cache. The Maven module `apps/nuxeo-ui` runs the same build with its own Node 20, which Angular 22 refuses, so the candidate builds it with Node 24 instead                                                                                                                                                                                                                                  |
| 5. The server packages   | `mvn package` at the root, every module but `apps/nuxeo-ui`, in a scratch copy: its version set with `versions:set` and `@VERSION@` stamped into `package.xml`, as `build-marketplace.yml` does. The `nuxeo-agentic-ui` package must carry stage 4's bundle file for file and byte for byte: its assembly leaves a missing bundle out without a word, and without the stamp its version is `@VERSION@`, which Nuxeo reads as 0.0.0. A plain `mvn package` at the root, as the repository stands, builds exactly that package   |
| 6. The packages as a set | Every package's dependencies, server packages' and kits', are in the candidate at a version Nuxeo counts as meeting them; no two conflict (`<conflicts>`); and each package's target platform is within the target platform of each package it depends on                                                                                                                                                                                                                                                                      |
| 7. The demo steps        | Listed, not run (below). A steps file that names a kit and declares no `serverRun`, declares it for another kit, or needs a seed the kit does not have is refused: the listing would make the kit's demo look shorter than it is                                                                                                                                                                                                                                                                                               |

**Nuxeo's rules, not semver's.** A dependency `name:min` or `name:min:max` is met as Nuxeo Connect
meets it: `release-candidate-set.mjs` ports nuxeo-connect-client 1.8.3's `Version`,
`PackageDependency`, `PlatformVersion` and `PlatformVersionRange`, read from their bytecode, and the
selftest holds it to 27 cases those classes answered when run. Three of them decide a candidate's
version: a snapshot is below its release, so is a classifier starting `rc`, `alpha` or `beta`, and
any other classifier, such as `build-marketplace.yml`'s `2026.0.2-PR-12-BUILD-3`, is above it.

### What it writes

| File               | What it is                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`    | Every artifact with its kind, name, version and SHA-256; the commit and every uncommitted path; `--since` and its commit; each kit's app, address, platform range, dependencies and the version it was held to; what was not compared; the demo steps |
| `SHA256SUMS`       | Every file of the candidate, in the form `sha256sum -c SHA256SUMS` reads from `--out`                                                                                                                                                                 |
| `RELEASE-NOTES.md` | The server packages, with their target platforms and dependencies, and each kit with what changed in it since `--since`: the pipeline's changelog, or new                                                                                             |
| `DEMO-STEPS.md`    | The demo steps a server run would execute                                                                                                                                                                                                             |
| `client/`          | The production bundle, as the package deploys it, and its files' digests                                                                                                                                                                              |
| `server/`          | Each module's jar, at the candidate's version, and each Nuxeo package Maven built                                                                                                                                                                     |
| `kits/`            | Each kit's zip, checksum and changelog, as the pipeline wrote them                                                                                                                                                                                    |

The working tree is built as it is. A candidate built with changes nobody committed says so, in the
run's first line, in the manifest and in the release note.

### The demo steps, listed

The demo steps are the beta harness's steps files that name a kit's folder. Each declares, beside
the preconditions that hold the run to it, what a server run of it needs:

```js
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: { users: [WORKFLOW_ADJUSTER], who: "the workflow's adjuster, not a supervisor" },
  signsInAs: [WORKFLOW_SUPERVISOR],
  needs: [
    'the kit 0.4.0 or later installed',
    'the dev server with `npm run config:dev` serving ...',
  ],
};
```

The people are the constants the preconditions check `NUXEO_USER` against, not copies of them. The
rest is read from the source, so it cannot disagree with what the file does: the labels of its
`h.step(...)` calls, in the order written, and the environment it and each seed read. The file is
imported to read its declaration, as the runner imports it to read `skipHttpCredentials`, and its
`run` is not called. Today that lists five files, three for the Payers kit and two for brand
assets; the contracts and facilities kits have no steps file, and the listing says so.

### In CI

[`release-candidate.yml`](../../.github/workflows/release-candidate.yml) runs the controls on a
pull request that touches the candidate or what it reads, and the whole candidate on every push to
a `staging/**` branch, held to `origin/main`: only `main` is published, so it is the last release.
No kit has reached `main` yet, so in CI each kit is new and the `--previous` check holds it to
nothing; held to an earlier staging commit on a laptop, it held three kits to their versions before
and wrote their changelogs.

- **One secret, for the install only.** The client cannot be built without the `@hylandsoftware`
  packages, so `npm ci` reads the read-only `SATORI_GH_READONLY_TOKEN` in its own step, as ci.yml's
  jobs do. The candidate's step runs with no token, checks so, and starts the script with `node`.
  No signing key, Marketplace credential or write permission is in the workflow.
- **The record is uploaded, not the candidate.** The repository is public, so anyone signed in can
  download a run's artifacts, and the bundle carries the `@hylandsoftware` packages: uploading it
  would publish them. The run's artifact is the manifest, the checksums and the two notes, and
  the job's summary shows the notes.

### Its controls

`npm run release-candidate:selftest` breaks each check once and must see each refused: the
dependency and platform cases Nuxeo answered; a package named twice, a dependency the candidate does
not hold, one held at a snapshot, an `rc` or out of its range, a version never stamped, a conflict,
and a target platform wider than its dependency's, of another name, or none; a disabled or
commented contribution, which registers nothing, and an unknown point, which is listed; two
repository kits built by the pipeline and read from their zips, which share nothing, then one given
the other's app id and one given the other's document type, which share exactly that; an output
directory that exists, which is left as it was, one under `business-apps/packages/`, a `--since`
that is no commit, `--out` given twice and a version a candidate cannot carry; and a steps file with
no declaration, one for another kit, and one needing a seed its kit does not have. It builds no
client and runs no Maven: the command's own run does that, through the same functions.

Run whole on 25 November 2026, the command was green on staging, and refused each of these, every
time with exit 1 and its directory removed: a third kit copied from contracts with its app id
changed to `payers-claims`, refused at stage 3 for that id; the same copy given the document type
`Claim`, refused at stage 3 for that type; a kit depending on `nuxeo-agentic-ui:2026.0.3`, refused
at stage 6 with the candidate's 2026.0.2 named; and a second run into the first run's directory,
refused with exit 2 and the directory's `SHA256SUMS` unchanged.

### What a server-side release run would add

This run proves the set holds together on paper. It does not install anything, so it cannot say:

- that Nuxeo installs the candidate: `nuxeoctl mp-install` of `nuxeo-agentic-ui` and then every
  kit, on a fresh server of each target platform, with the dependency resolution Nuxeo does itself
  rather than this port of it;
- that the server starts with them all: a component whose `<require>` names one nobody contributes,
  or a contribution the server refuses at startup, shows only there;
- that the app registry serves every kit's app to its groups, and the shell's "Switch app" lists
  them;
- that each kit's seed runs and each demo steps file passes, which needs the seeds' administrator
  and the demo people's passwords: the listing above is what such a run would execute;
- an upgrade from the last release's packages that keeps every app's configuration, which is phase
  10's second demo;
- that the candidate's signature and the Marketplace's own checks pass, which need the keys and
  credentials section 9 proposes.
