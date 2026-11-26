# The package pipeline: its first stage

Phase 0 of the [development plan](development-plan.md) builds the package pipeline's first stage:
validate, sign, publish to pre-production. Phase 3 completes it, with versions, signatures and
promotion after a person approves.

Status: built on 22 November 2026, and not yet run in full. The checks run on every pull request;
signing and publishing run only for a tag, and no tag has been pushed yet. Versions were added on
23 November 2026 (section 8). Signatures were built on 26 November 2026, with their verification
before a publish, in the release candidate and at install (section 9); the workflow has signed no
package yet, and promotion after a person approves is still a proposal.
The upgrade check, phase 10's offline half of "an upgrade that keeps every configuration", was
added on 25 November 2026 (section 10); its server-side half is not built.

## The short version

- **Checked on every pull request, with Node and `unzip` alone.** A package that names a widget
  the platform does not have fails, and the log names the file, the place and the widget.
- **Signed and published only when someone tags it.** The tag is meant to go on a merged commit,
  which nothing enforces yet (section 9.1), and the package goes to Nuxeo Marketplace preprod, as
  the platform's own package does. It is signed
  keyless, through Sigstore with the run's GitHub identity, and published only once its signature
  verifies against the trusted signers, as the release candidate and an administrator verify it
  (section 9).
- **A package's own code never runs where the secrets are.** The jobs that sign and publish only
  check, sign, verify and publish the zip the first job built; only the one that signs has an
  identity, and only the one that publishes a secret.
- **Held to a content model.** With `--model`, a model file exported from a server, a layout whose
  widget does not show its property's type is refused, and so is a field whose property the type
  does not have. Given none, a package that ships a stand-in model, as the kits do, is held to its
  own `content-model.json`, in CI too; a package on a customer's model, given none, passes these
  (section 4).
- **Every label key has a text,** in the package's `labels/en.json` or in the platform's English
  catalogue. One with neither is refused, by its key and its file.
- **A language's labels are a subset of English's.** `labels/<language>.json`, which Crowdin writes
  beside `labels/en.json`, may leave keys out, since each falls back to English; a key
  `labels/en.json` has no text for is refused, by its key and its file.
- **A facet names an aggregate its page provider defines,** when the package's own model defines
  that page provider; so does a home's figure. Only the search index answers aggregates, and a facet
  on anything else is left out of the queue, said only in the browser's console.
- **A page provider's NXQL holds nothing Nuxeo's grammar has no place for,** for the page
  providers the package defines: `BETWEEN NOW(...)`, a string or a parenthesis left open, `==`,
  `&&`. A check of its tokens, not a parse: a query it passes may still be refused (section 2).
- **A queue's or a related list's columns and sorts are the listed records' properties,** when
  the package's own page provider says, in its NXQL, which type it lists: held to that type in the
  content model, as a layout's fields are held to theirs (section 2).
- **Its version is held to what changed.** Given the package as it was, a version that did not move
  when the content changed is refused, and so is one that moved less than the changes need: a
  queue removed needs a major. Each build writes what changed beside the zip (section 8).
- **An upgrade keeps every customer configuration.** Given the package as it was, and the platform
  as it was, what a customer may override or name in the kit, and what the kit names of the
  platform, is removed or renamed only with a migration note and the version that needs; a label
  key, a property, a page provider or a document type the kit still names is never removed.
  Offline, with no server (section 10).
- **Every kit at once, as a release candidate.** One command builds the client, the server
  packages and every kit, and refuses a set that does not hold together: a dependency Nuxeo would
  not count as met, two kits contributing the same name, a kit whose version did not move since the
  commit it is held to. It runs offline on every push to a staging branch, which holds each kit to
  the commit before the push, since no kit has a release yet (section 11).

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
provider exists. What step 2 reads in a page provider the package defines is the aggregates it
lists, which a queue's facets and a home's figures must name, and the type its NXQL lists, which a
queue's and a related list's columns and sorts are held to (section 2). The kit's
own controls check its route model
([its README](../../business-apps/packages/payers-claims-demo/README.md)).

## 2. The steps

`scripts/app-package.mjs` runs steps 1 to 6 on one package, each stopping the run when it fails.
It first removes the zip and checksum an earlier run left for the package's name and version, so
a refused package leaves nothing installable behind, not even an older zip that looks current. The
one exception is a `package.xml` that is a symbolic link, whose name is not read (below).
The workflow, [`app-packages.yml`](../../.github/workflows/app-packages.yml), runs it on every
package, and runs steps 7 and 8 for a tag.

| Step              | What is checked or done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The builder    | Nothing in the package is a symbolic link, and its `build.mjs` is the generator's, byte for byte, so the code that builds it is code this repository reviewed. A `package/install.xml` that is a folder is refused here, since no step before the builder reads it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2. The definition | `bundle/agentic-ui-config/` has an `app.json`, and the validator finds nothing, given the deployment's allow-list, what it registers, its platform version, the platform's English catalogue, and a content model: the one given, or a stand-in package's own (section 4). Every label key has a text, and a language's labels give only keys English has; a facet or a figure on the package's own page provider names an aggregate it defines, and a column or a sort on one names a property of the type its NXQL lists; the NXQL of a page provider the package defines holds nothing Nuxeo's grammar has no place for, by a check of its tokens; the layouts the component contributes are the ones the validator read, and so is the app it contributes to the app registry, with its files |
| 3. The version    | `app.json`'s `packageVersion` and the manifest's `Bundle-Version` are `package.xml`'s version, and the tag, when publishing, is `app-package/<name>/<version>`. Given the package as it was, `--previous`, the version moved as far as the changes need (section 8), and the upgrade keeps every customer configuration (section 10), the platform's side too given `--previous-platform`                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4. The build      | `build.mjs` writes the zip, refusing what the server would refuse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 5. The zip        | `verify-package-zip.mjs` finds a well-formed Nuxeo Package. A zip it refuses is removed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6. The checksum   | The zip's SHA-256, beside it, in the form `sha256sum -c` reads. The build is reproducible, so the same source gives the same digest. Given `--previous`, the changelog beside it too, `<name>-<version>.changes.md`, with the migration notes that cover the upgrade                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7. Signed         | Keyless, through Sigstore: `actions/attest` signs a statement of the package, its version, the zip's SHA-256, the commit and the run, which `app-package-signature.mjs verify` checks against the trusted signers at once; and a build provenance attestation, as before. Skipped, with a warning, when the run has no identity or is no trusted signer (section 9)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 8. Published      | Only a signed zip, its signature verified again first: Nuxeo Marketplace preprod, through the same `nos-publish` step `build-marketplace.yml` uses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

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

Step 2 holds each other language's labels to English's: every key `labels/<language>.json` gives
must have a text in `labels/en.json`. A subset passes, none at all included: a key a language
leaves out falls back to English, key by key, on the server (app-definition-v2.md, section 7) and
in the app. A key English lacks is a finding, `unknown`, with the key and the file: it is a
misspelt or stale key, which no file names, and which Crowdin, writing a language's file from
`labels/en.json`, never asks a translator for. As every file of the app, a language's file is named
in the component (`<file path="labels/<language>.json" />`, which the `app-registry` generator
writes), or refused, since the registry would never serve it; and a new one is an addition, so
the version rises at least a minor (section 10).

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

Step 2 checks the NXQL of each page provider the package defines that takes NXQL, a
`coreQueryPageProvider` or a `genericPageProvider` of one of Nuxeo's NXQL classes (the search
service's, the index's, the repository's), its pattern or its where clause's fixed part, read as
the server reads it, CDATA included, before any server loads it (`nxqlProblems`, in
`libs/shared/app-definition/src/lib/page-providers.ts`). A page provider of another class, such
as the audit's, whose pattern is not NXQL, is not read. **It is a check of the query's tokens,
not a parser, and it does not validate NXQL.** It refuses only constructs Nuxeo's grammar has no
place for, meant to refuse no query Nuxeo runs, though only the kits' queries and the spec's
cases have shown it: a string left open; a parenthesis not closed, or closing nothing; `==`,
`&&`, `||`, `;`, or a `!` that is not `!=`, outside a string; a `BETWEEN` whose bounds are not
each a literal (a string, a number, `DATE '...'`, `TIMESTAMP '...'`) or a parameter, such as
`BETWEEN NOW('-P1D') AND NOW('P7D')`, which a server answered 400 in the moves kit's run; and a
pattern that does not start with `SELECT`. Each is a finding naming the component, the page
provider and the element. It does not
check that the properties a query names exist, that an operator fits its operands, a function's
name or arguments (`NOW()`'s duration among them), an `IN` list, the parameters a page provider
will be given, the order of the clauses, or what the search index's conversion of NXQL refuses
that the repository takes; nor a page provider of the server's, or a quick filter. A query it
passes may still be refused on install: a read-only query on a development server is still the
test. Every kit's page providers pass it.

Step 2 holds a queue's columns and sort, and a related list's, to the records their page
provider lists, given a content model: the one given, or a stand-in package's own (section 4).
For a page provider the package defines, the type it lists is read from its NXQL, the pattern's
`WHERE` or the where clause's fixed part, as the server builds the query, and only where it says
so plainly: `ecm:primaryType = '<Type>'`, as `app-model` writes it, among conditions joined by
`AND` alone, not under a `NOT`, with no `ecm:mixinType`, whose facet would bring schemas of its
own. A pattern `FROM <Type>` is not read, since it lists the type's subtypes too. Each column's
property, and each sort's, must be one of that type's or of a facet it declares, and a column's
widget must show its property's type, as a layout's field is held (section 4). One that is not is
a finding in the validator's form, naming the file, the place, the type, the page provider and
its component. Not checked: a page provider the package does not define, which is the server's;
one whose NXQL does not say its type, such as one with an `OR` at its top, or whose type the
model does not have; a package given no content model, such as a customer's in CI; the server's
own properties, `ecm:`; and a column a computation fills
(`libs/shared/app-definition/src/lib/page-providers.ts`).

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
package as it was, to hold its version and its upgrade to (sections 8 and 10), and
`--previous-platform` the platform as it was, to hold what the package names of it to (section 10).

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

The upgrade check has controls of its own, `npm run app-upgrade:selftest` (section 10).

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
   signs the zip, verifies the signature and publishes it, with what changed since in the run's
   summary.
4. Anyone can check the signature before installing it, with the GitHub CLI signed in, which reads
   the repository's attestations (section 9.1):

   ```bash
   gh attestation verify payers-claims-demo-0.3.0.zip --repo nuxeo/Nuxeo-Satori-UI \
     --predicate-type https://github.com/nuxeo/Nuxeo-Satori-UI/app-package-signature/v1 \
     --cert-identity https://github.com/nuxeo/Nuxeo-Satori-UI/.github/workflows/app-packages.yml@refs/tags/app-package/payers-claims-demo/0.3.0 \
     --source-ref refs/tags/app-package/payers-claims-demo/0.3.0 --deny-self-hosted-runners
   ```

A tag rather than a button: a manually dispatched workflow must be on `main`, which this one
reaches only when the integration branch does, and a tag names exactly what is published.

## 6. Phase 0's demo, steps 1 and 2

1. In a pull request, change a widget of the demo's layout to `calendar`. The check fails, and
   its log names the layout file and then
   `cards[0].fields[1].widget: the widget "calendar" is not registered [unknown]`.
2. Put it back. The check passes, and tagging the merged commit publishes the package to preprod.

## 7. Not settled here

- **Signing** is built, keyless, and waits for its security review with the others
  ([security-reviews.md](security-reviews.md)): the workflow has signed no package yet, since no
  tag has been pushed (section 9).
- **The first publish of a new package name** may need it registered on Nuxeo Connect's staging
  environment first. Not checked.
- **Who may publish:** anyone who can push a tag. A ruleset can restrict `app-package/*` tags, and
  none does yet. A signature names the tag's run, not who pushed the tag.
- **Promotion to production after a person approves:** proposed in section 9, a GitHub
  environment with required reviewers; not built. Versions are section 8's.
- **The allow-list** is the deployment's (decision 3), never in a package's bundle. The workflow
  passes a kit's `deployment/build-allow-list.json` with `--allow-list` when the kit has one,
  which today only the Payers kit does; a kit without one is built with none, and every operation
  its buttons run is refused ([`app-packages.yml`](../../.github/workflows/app-packages.yml)).
- **Where kits live:** under `business-apps/packages/`, beside the pipeline that checks them,
  decided on 26 November 2026 ([decisions.md](decisions.md), "Settled"). Version 1's configuration
  packages moved to nuxeo/Nuxeo-Satori-Config, whose builder is the platform's configuration
  package builder and checks none of an app definition's version 2 files.
- **Not exercised yet:** steps 7 and 8, which run only for a tag.
- **The workflow passes no server's content model.** A kit that ships a stand-in model is held to
  its own `content-model.json` on every pull request (section 4). A package on a customer's model
  is held to none there: whether such packages commit their server's model, and where, is open.
- **A facet on the server's page provider.** The pipeline reads no server, so a facet whose page
  provider the package does not define is not checked: `describe_page_provider` lists a server's
  aggregates. Nor is an aggregate's type, a terms aggregate on a date, say.
- **Label keys in other languages.** A key with an English text passes; one missing from
  `labels/fr.json` falls back to English, and is not refused. A file whose every text is English's,
  which is what Crowdin's approved-only export writes before anything is approved, passes too:
  `npm run i18n:coverage` counts such texts as "as English", and nothing refuses them. The app's
  catalogues have guards against a destructive pull (`checkCataloguesAreTranslated`,
  `checkTranslationCatalogues`); a kit's files have only the validator's, which refuses a blank
  text. A pull that turns a kit's real translations back into English passes every check, and the
  kits' pull request body asks its reviewer to look for exactly that.
- **Removing a key from a language's labels** is still rated breaking (section 10), as removing it
  from English is, though the key then shows in English rather than as itself.
- **A facet a record gains at run time.** A field whose property only such a facet brings is
  refused when a model is given, and the message names the facet. The record page shows it on a
  record that has the facet. Whether the pipeline should accept it, perhaps when a rule shows the
  field only on records with that facet, is open.
- **NXQL is not parsed.** Step 2 looks for constructs Nuxeo refuses in a package's own page
  providers, by their tokens (section 2): a query it passes may still be refused on install, and
  a server's page providers, and quick filters, are not read at all. Whether to carry Nuxeo's
  grammar, and so parse a query as the server does, is open.
- **Not held to the model yet:** a queue's or a related list's columns and sorts on the server's
  page provider, or on one whose NXQL does not say plainly which type it lists (section 2); the
  properties a computation, a rule or a widget parameter names; a task form's fields; and a
  vocabulary widget's `directory` against the one its property is bound to.

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
0.10.0-rc.1. On GitHub it runs on every pull request that changes a kit or the platform's
sources: on one on 26 November 2026, each kit's version was held to the staging commit it was
based on. Its tag path has not run there, since no `app-package/*` tag has been pushed.

**Not yet:** `validate_package`, in the Builder MCP server, takes no previous package, so an agent
learns that a version must move only from the pipeline.

## 9. Signatures and promotion after approval

Status: signing and its verification built on 26 November 2026; promotion after a person approves
(9.2) is still a proposal. **Not yet run on a tag:** no `app-package/*` tag has been pushed, so the
workflow has signed no package, and the verification of a keyless signature has run only against a
stand-in for `gh` in the controls, never on a bundle Sigstore issued. The first tag is its first
real run. No key, tag, secret, environment or ruleset was created, and nothing was published.

### 9.1 Signing

Built as proposed, keyless, with three departures, each said below.

**What is signed.** An in-toto statement with one subject, the zip, by its file name and its
SHA-256, and a predicate of the type `https://github.com/nuxeo/Nuxeo-Satori-UI/app-package-signature/v1`
that records the package's name, its version, the same SHA-256, the commit it was built from, and
who signed it: the repository, the workflow, the tag and the run, or an Ed25519 key's id. The
signature is detached, `<name>-<version>.zip.sig.json` beside the zip, and the zip is not changed
([`package-signature.mjs`](../../scripts/package-signature.mjs)).

| Signer                                   | Where                                                                  | The signature                                                                                                                                                      | Checked with                                     |
| ---------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| The `app-packages.yml` workflow, keyless | A tag build's `sign` job                                               | The Sigstore bundle `actions/attest` writes: its certificate, issued for minutes to the run's GitHub OIDC identity, and the signature are in Sigstore's public log | `gh attestation verify`, pinned as below         |
| An Ed25519 key                           | A local run, the controls, or a deployment that signs with its own key | A DSSE envelope, signed with Node's crypto                                                                                                                         | Node's crypto, with the trusted key its id names |

- **Where the keys live: nowhere this team keeps one.** CI has no key and no secret to sign with.
  Locally, `sign --ephemeral-key` makes a key for the run and never writes it: its public half is
  written as a trusted-signers file to verify with. `--key` takes a key from a file, and refuses
  one inside the repository, where it would be a commit away from being published.
- **Who may sign: the trusted signers,**
  [`business-apps/trusted-signers.json`](../../business-apps/trusted-signers.json): today the
  `app-packages.yml` workflow of `nuxeo/Nuxeo-Satori-UI`, and no key. A deployment may keep a copy
  of its own, with its own keys, and give it with `--trusted-signers`. The file is read strictly: a
  kind or a field it does not know, an id given twice, a key that is not Ed25519, or anything but a
  public key's PEM, a private key above all, which Node would otherwise take for its public half,
  is an error.
- **What a verification holds a zip to,** `app-package-signature.mjs verify`, each a refusal:
  - a signature, beside the zip or where `--signature` says: one JSON document, or JSON lines as
    `gh attestation download` writes them, each line whose statement is a package signature
    verified on its own, the zip passing when one of them does;
  - a trusted signer. An Ed25519 envelope is checked with the trusted key its key id names, never
    with a key the file carries. A Sigstore bundle is checked by the GitHub CLI,
    `gh attestation verify`, with the certificate's identity pinned whole to the trusted workflow's
    run for the package's own tag,
    `--cert-identity https://github.com/nuxeo/Nuxeo-Satori-UI/.github/workflows/app-packages.yml@refs/tags/app-package/<name>/<version>`,
    with `--cert-oidc-issuer https://token.actions.githubusercontent.com`, `--source-ref` the tag,
    `--source-digest` the commit the predicate names, `--predicate-type` the signature's, `--repo`,
    and `--deny-self-hosted-runners`. What the predicate says of who signed is the run's own word,
    so it must agree with what the certificate binds, and is never taken alone;
  - the subject: the zip's file name, and the SHA-256 of its bytes, so one changed byte is refused;
  - the package and version: the predicate's must be the zip's file name's, the `package.xml`'s
    inside it, and `--name`'s and `--version`'s when given. So another version's signature is
    refused beside this version's zip, on its own zip renamed to pass for this version, and held to
    a version it is not; and a keyless one made by the run for another tag has another identity.
- **Where it is checked:**
  1. in the `sign` job, just after signing, as any later reader checks it;
  2. in the `publish` job, before publishing, so nothing unverified reaches preprod;
  3. by the release candidate, given `--signatures` (section 11);
  4. at install, before `nuxeoctl mp-install`, by the administrator
     ([administrator-guide.md](administrator-guide.md), section 3). Whether Nuxeo's package
     manager, or the app registry, could check one itself is still the platform team's question.

```bash
# Locally: sign with a key made for the run, then verify with its public half.
npm run app-package:signature -- sign business-apps/packages/payers-claims-demo/dist/payers-claims-demo-0.7.0.zip \
  --ephemeral-key --signers-out /tmp/signers.json
npm run app-package:signature -- verify business-apps/packages/payers-claims-demo/dist/payers-claims-demo-0.7.0.zip \
  --trusted-signers /tmp/signers.json
# A tag's signature, beside its zip, against the repository's trusted signers.
npm run app-package:signature -- verify payers-claims-demo-0.7.0.zip --name payers-claims-demo --version 0.7.0
# Once the run's artifact has expired: the repository's attestations of the zip, renamed. gh
# names the file for the zip's digest, `sha256-<digest>.jsonl` on Windows.
gh attestation download payers-claims-demo-0.7.0.zip --repo nuxeo/Nuxeo-Satori-UI \
  --predicate-type https://github.com/nuxeo/Nuxeo-Satori-UI/app-package-signature/v1
mv "sha256:$(sha256sum payers-claims-demo-0.7.0.zip | cut -d' ' -f1).jsonl" payers-claims-demo-0.7.0.zip.sig.json
```

It exits 0 when the zip is verified, 1 when it is refused, with each reason, and 2 when the command
or the trusted signers are wrong. `sign` records `git rev-parse HEAD` as the commit only when the
working tree has nothing uncommitted; otherwise `--commit` must say which commit the zip was built
from. The GitHub CLI's flags were checked on 2.83.1; one that lacks a flag refuses it as unknown,
so the check fails closed. `verify` needs Node, `unzip` and, for a keyless signature, the
GitHub CLI, which reads Sigstore's trusted root over the network unless `--trusted-root` gives a
file of it, for a server offline: `gh attestation trusted-root > trusted_root.jsonl`, once, where
there is a network. Not tried yet.

**In CI** ([`app-packages.yml`](../../.github/workflows/app-packages.yml)), for a tag
`app-package/<name>/<version>` only:

```text
check    builds and verifies the zip, its checksum and its changelog, and uploads them
sign     contents: read, id-token: write, attestations: write, and no secret: checks the
         checksum; ci-plan decides; actions/attest signs the statement, and
         attest-build-provenance attests the build as before; verifies the signature; uploads it
publish  contents: read, and the Marketplace credentials; only when sign signed: checks the
         checksum, verifies the signature, publishes to preprod
```

- **The skip logic, `ci-plan`.** It signs only a tag build of the package the tag names, on
  GitHub's own runners, with an OIDC identity, by a workflow the trusted signers name. With no
  identity, on a self-hosted runner, on another server, or by a workflow they do not name, such as
  a fork's, nothing is signed: it writes `sign=false`, a warning, "Not signed, not published",
  saying why, and the same in the job's summary, and `publish` does not run. On a branch, or on a
  tag that names another package or version than the zip's, it refuses, exit 1.
- **What changed in the permissions,** on 26 November 2026. Before, one job, `sign-and-publish`,
  had `contents: read`, `id-token: write` and `attestations: write`, and read the Marketplace
  credentials. Now `sign` has those three and no secret, and `publish` has `contents: read` alone,
  and the credentials. The workflow's own stays `contents: read`. Nothing was added: the identity
  left the job that holds the secrets.
- **A value from the tag** reaches a shell only through an environment variable, since a tag's
  name may hold `$(`.
- **The signature is kept** with the repository's attestations, which `gh attestation verify
--repo` reads, and for 30 days in the run's artifact `app-package-signature`.

**Its controls,** `npm run app-package:signature-selftest`, in the `check` job on every pull request
that touches a package or what checks one, with Node and `unzip` and no install. The packages are
the contracts kit, built by the pipeline at its version and at the next. Each break is refused for
its own reason, and the sound package passes:

- **Ed25519,** with keys made at run time: a good signature verifies, with what it records, and no
  private key is written. Refused: a changed byte; the statement changed after it was signed; a key
  no trusted signer has; another key's signature under a trusted key's id; no signature; another
  version's signature beside its zip, on its own zip renamed, and held to `--version`; a trusted
  signer's statement naming a version the zip's `package.xml` does not declare; a signature entry
  that is not an object, with a reason and not a stack trace; the repository's trusted signers,
  which name no key; a `--key` inside the repository; and trusted signers that are empty, of an
  unknown kind, with an id twice, a field not read, an RSA key, a private key, or a workflow
  outside `.github/workflows/`.
- **Keyless,** with `gh` stood in for by a script on the PATH that holds a bundle to a stand-in
  certificate in it, as gh holds a real bundle to its certificate: the good one verifies, and gh
  was given exactly the pinned arguments. Refused: a changed byte, and another version's signature
  beside its zip, before gh is asked; a workflow that is not a trusted signer; a predicate whose run
  was for another tag; a fork's certificate under a predicate claiming the trusted workflow; a
  certificate of another version's tag; a self-hosted runner; a commit the certificate's run was
  not on; and no gh on the PATH. JSON lines of the provenance, a fork's signature and the genuine
  one verify by the genuine one; JSON lines with no package signature, or whose every signature is
  refused, are refused, each line by its reason. These prove
  this repository's side, what it pins and what it refuses, and not Sigstore's cryptography, which
  is gh's. With the GitHub CLI installed, every flag passed to it is one it has: 2.83.1 here.
- **`ci-plan`:** it signs with the identity, and its predicate, signed, verifies; it skips with no
  identity, on a self-hosted runner, on a fork's run and on another server; it refuses a branch, and
  a tag of another version.
- **The workflow:** only `sign` has an identity, its signing steps run only when `ci-plan` said so,
  `publish` runs only when `sign` signed, verifying before it publishes, and each verification pins
  the tag's name and version. Each, broken in a copy of the workflow's text, is refused.

Each check was also seen failing from the other side, on 26 November 2026: the verifier broken in
place one way at a time, the controls run, and the verifier put back. Not comparing the digest
failed 4 controls; not comparing the subject's name, 1; trusting any key, 1; not checking the
signature's bytes, 2; not holding the file name, 1, or the version expected, 1; not pinning the
certificate's identity, 5, or the source commit, 4; not holding the predicate's tag, 1; taking
gh's refusal as a pass, 6; not refusing a missing signature, 1; not reading `package.xml`, 1;
taking any PEM for a public key, 1; passing JSON lines on any line, 2; and in `ci-plan`, not
checking the identity, the runner or the signer, 1 each. The release candidate's, in section 11.

**Departures from the proposal:**

- **A predicate of its own, beside the provenance.** The proposal checked the build provenance
  attestation. Its statement names the zip and the tag, but not the package and the version as
  fields, and an Ed25519 signer could not make one honestly. So the signature is a statement of its
  own, the same for both signers; the provenance is still made, as before, and is what
  `gh attestation verify --repo` checks by default.
- **The certificate's identity, whole.** gh matches the proposal's `--signer-workflow` as the start
  of the certificate's identity; `--cert-identity` is matched whole, the workflow and the tag, and
  `--source-ref` and `--source-digest` hold the tag and the commit as well.
- **Two jobs instead of one,** so that the identity and the secrets are never in the same job.

**Not built, and still proposals:**

- promotion after a person approves, and any publish to production (9.2);
- a ruleset for who may create `app-package/*` tags, and that none may be moved or deleted
  (section 7). Until there is one, whoever can push a tag starts a run the trusted signers accept,
  and a signature says that this workflow ran for this tag on this commit, not that the commit was
  reviewed. The certificate names the tag, not its commit: a tag deleted and pushed again on
  another commit signs a second zip of the same version, which a publish and an administrator's
  check take as they take the first. A tag's run takes the workflow as
  the tagged commit has it, so a tag on a commit that changed the workflow signs with that change.
  The release candidate refuses a signature from a commit that neither its history nor a
  `origin/main` holds (section 11); a publish and an administrator's check do not;
- a key the team holds, in a cloud KMS, if a customer's policy asks for one: the trusted signers
  take an Ed25519 key already, and nothing else of it is built;
- the release candidate's workflow giving `--signatures`, which waits for a kit to be signed;
- Nuxeo's package manager, or the app registry, checking a signature on the server;
- a verification offline with `--trusted-root`, which has not been tried.

### 9.2 Promotion after a person approves: a proposal

Proposed: **build once, publish to preprod on the tag, and promote the same bytes to production
once a named person approves, in a GitHub environment.** Not built.

```text
tag app-package/<name>/<version>
  check    builds and verifies the zip, its checksum and its changelog, and uploads them
  sign     signs the zip, and verifies the signature (9.1)
  publish  verifies the signature, publishes to preprod (9.1)
  promote  environment app-packages-production: waits for an approval, then takes the
           same artifact, checks the checksum and verifies the signature, publishes to production
```

- **The approval is a GitHub environment,** say `app-packages-production`, with required
  reviewers, a team rather than one person, and "Prevent self-review" on, so whoever pushed the
  tag cannot approve it; and with its deployments limited to `app-package/*` tags, so no branch can
  reach it.
- **Its secrets are its own.** The production Marketplace credentials would be environment
  secrets of `app-packages-production`, which a job reads only once approved. Today's
  `CONNECT_PREPROD_*` would move to an `app-packages-preprod` environment the same way.
- **What the approver sees,** in the run's summary: the changelog since the last release (section
  8), the part the version needed and the part it raised, the zip's digest, its signature, and
  the preprod install to try. Approving says that these bytes, tried in preprod, go to production.
- **The same bytes.** The promotion job never builds: it takes the artifact of the same run, as
  `publish` does. GitHub expires a job waiting for approval after 30 days, and the
  artifact is kept 30 days (`retention-days`), so the two must stay aligned.
- **The record:** GitHub keeps each deployment, who approved it and when; the tag names the
  commit, and the signature the package, its version, its digest, the commit and the run.
- **Who may start it:** a ruleset restricting who may create `app-package/*` tags (section 7
  notes that none does). Without one, anyone who can push starts the chain, and the approval still
  stops it short of production.
- **Rolling back** is publishing a higher version with the earlier content: a version is never
  published twice. Removing what a version added is a breaking change, and section 8 asks for its
  raise.

### 9.3 What the user decides

1. Keyless signing, or a key in a KMS, and the verification policy: which workflow and which refs.
   Acted on as recommended: keyless, by the `app-packages.yml` workflow, for the package's own tag
   alone (9.1). Still theirs and the security owners' to confirm.
2. Whether installs check the signature, and where. The administrator's guide says how, before
   `mp-install`, and the release candidate does given `--signatures`; nothing on a server enforces it.
3. The environments' names, their reviewers, and whether preprod also waits for an approval.
4. Production's Marketplace target and credentials, which the `nos-publish` step takes as it takes
   preprod's (the name of its production environment is not checked here).
5. The ruleset for `app-package/*` tags.

## 10. The upgrade check

Phase 10 of the [development plan](development-plan.md) asks for "an upgrade that keeps every
app's configuration". This is its offline half, built on 25 November 2026: it runs in CI with no
server, and nothing here installs anything on one. Its server half, built on 26 November 2026,
reads a running server before an install, and changes nothing there
([On a server, before the install](#on-a-server-before-the-install)).

A customer's configuration is made on one version of a kit and of the platform. Their own package
layers over the kit's: it `<require>`s the kit's component to come after it, replaces or disables a
layout by its type and mode, overrides a menu entry or gives a label another text by its ID, and
names the kit's queues, properties and page providers in files of its own. The version rules
(section 8) say how far a version must move; they do not say whether such a configuration still
finds what it names. The upgrade check compares the package as it was with the package as it is,
and the platform as it was with the platform as it is, and refuses an upgrade that takes something
such a configuration relies on away, unless a migration note says what to do instead.

[`scripts/app-upgrade-check.mjs`](../../scripts/app-upgrade-check.mjs) is the check. The XML is
read by `verify-package-zip.mjs`'s helpers, as the rest of the pipeline reads it, and nothing is
read through a symbolic link.

### What is refused

**On the kit's side**, each item named as a note names it:

| Item                                                                               | What a customer's configuration does with it                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout <Type>/<mode>`, `fragment <layer>/<name>`, `asset <name>`                  | Replaces or disables it by its key, in a component that comes after the kit's                                                                                                                                                                                                   |
| `app <id>`, `address <address>`                                                    | "Switch app" lists it, and a link opens it                                                                                                                                                                                                                                      |
| `component <name>`                                                                 | `<require>`s it to come after it. Nuxeo leaves a component whose requirement is missing unstarted, so it contributes nothing                                                                                                                                                    |
| `schema <name>`, `property <prefix>:<name>`, `type <name>`, `page-provider <name>` | Names them in its own layouts, queues, rules and home: only the kit's own schemas' properties, not `dc:` or another platform schema's                                                                                                                                           |
| `queue <id>`, `task-form <workflow>.<step>`, `home`, `menu`                        | Links to them, or names them in its own menu and home                                                                                                                                                                                                                           |
| `menu-entry <id>`                                                                  | Overrides it in its manifest, as `appMenu.<id>`, the ID the `navbar` slot gives it ([extension-reference.md](../extension-reference.md), section 3). Only an entry that opens a queue or the home: one for a platform page is not added to the slot, so nothing can override it |
| `labels <language>`, `label <language> <key>`                                      | Gives a key another text in its manifest's `labels`, or names it                                                                                                                                                                                                                |
| `action <id>`                                                                      | Names it in a queue or a record page, or overrides it                                                                                                                                                                                                                           |

- **Removed or renamed, with no note:** refused. A rename is a removal and an addition; the finding
  names what was added of the same kind, so that its note can say `renamedTo`. A menu removed takes
  its entries with it, a labels file its keys and a schema its properties, and each is said once.
- **A configuration layer whose precedence changes, with no note:** refused. Nuxeo registers a
  component's contributions after those of every component it requires, and a later contribution
  on the same key wins (`ContributionRegistry` in `nuxeo-agentic-core`), so three things move a
  layer: `requires <component>`, the component's `<require>`s changed; `contributor <key>`, a
  layout, fragment, asset or app, or a schema, a document type or a page provider, moved to another
  of the kit's components; `disables <key>`, a contribution the kit newly disables with
  `enabled="false"`.
- **What disappears while the kit still names it:** refused, and no note mends it.
  `label-key <key>`: a key gone from every labels file of the kit, and not one of the platform's
  English texts, while a file of the kit still names it, so the page shows the key.
  `property <prefix>:<name>`: a property gone from the kit's schema while a field, column, sort,
  rule, computation or template of the kit still names it. `page-provider <name>`: one gone while
  a queue, a home's figure or a related list of the kit still reads it. `type <name>`: a document
  type gone while the kit still contributes a layout for it.
- **A version that does not rise as far as these need.** Each finding is breaking, so it needs a
  major, or a minor below 1.0.0, as section 8 reads a version, whatever the version rules made of
  the file it is in. The version rules already rate a queue, a layout or a label key removed as
  breaking. They rate a menu entry, a property, a page provider, a component or a contributor as
  a change, or a change to judge, which a patch or a minor passes, and the upgrade check refuses
  that: _the upgrade needs more of the version than it was given: the changes since 0.4.0 need a
  minor version … and 0.4.1 raises the patch._

**On the platform's side**, what a kit names of the platform, as it was or as it is, against what
the platform registers at each of the two refs:

| Item                                                       | Read, at each ref, from                                                                                                                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id <id>`                                                  | The `app.` and `nxs.` IDs `docs/extension-reference.md` documents, as its drift gate reads them, and the rules, computations, checks, row and bulk actions and pages of `registries.ts`, which the validator holds a kit to |
| `widget <name>`                                            | `registries.ts`'s widgets                                                                                                                                                                                                   |
| `component <name>`, `extension-point <component>/<point>`  | `nuxeo-agentic-core`'s `OSGI-INF` components                                                                                                                                                                                |
| `descriptor <element>`, `descriptor <element>@<attribute>` | The descriptors those extension points take, by their `@XObject` and `@XNode` annotations                                                                                                                                   |
| `menu-prefix <prefix>`                                     | `APP_MENU_ID_PREFIX`, the prefix of an app's menu entries in the `navbar` slot                                                                                                                                              |

A kit names an ID or a widget in a value of its JSON files, a label's or a `labelKey`'s apart, and
a component, an extension point and a descriptor's elements and attributes in its own components.

- **Gone while the kit as it is still names it:** refused, and no note mends it: mend the kit. For
  an ID or a widget, the pipeline's step 2 refuses it first, as unknown.
- **Gone, and named only by the kit as it was:** a configuration made on that version breaks. It
  needs a note in [`platform-upgrade-notes.json`](platform-upgrade-notes.json), and the platform's
  version, `libs/platform/package.json`'s, raised by a major, a minor below 1.0.0, as
  [extension-reference.md](../extension-reference.md), section 1, promises for an ID.
- **A file the platform as it was says what it registers in, which the platform as it is has
  not:** refused, rather than read as everything it listed being removed. If it moved, the check's
  `PLATFORM_SOURCES` must follow it. One that the platform as it was had not is said, and what it
  lists is not compared. A platform version that cannot be read, as it was or as it is, refuses a
  removal, since the version it needs cannot be held to.

`registries.ts` is imported at each ref, to read what it registers exactly: it is plain data, and
the repository's own reviewed code at that commit, its library checked for links first. One Node
cannot load stops the run, exit 2.

### A deployment's own layer

A server's deployment layer ([app-definition-v2.md](app-definition-v2.md), section 10) holds the customer's own versions
of an app's layouts and queues, made in the designer, and each overrides the kit's file at its
path. Given that server's export, `--deployment <file>`, what `GET /nuxeo/agentic-ui-apps/layer.json`
answers an administrator, the check **warns** for each file of the kit's app the deployment
overrides that the upgrade adds, changes or removes: the override keeps winning, so the kit's
change does not show on that server until an administrator takes it into a new draft and has it
approved, or rolls the override back to the package's version. A warning refuses nothing and
leaves the exit code alone, since no configuration is lost; a file the upgrade leaves as it was
says nothing, and an export that is not one is a command that cannot be run, exit 2. The controls
are `npm run app-upgrade:selftest`'s.

### Migration notes

A kit's notes are its `upgrade-notes.json`, beside `package/`, outside the zip, so a note changes no
version. The platform's are
[`docs/business-apps/platform-upgrade-notes.json`](platform-upgrade-notes.json).

```json
{
  "version": 1,
  "notes": [
    {
      "version": "0.2.0",
      "item": "address contracts",
      "renamedTo": "address contract-desk",
      "note": "The app opens at contract-desk, not contracts: ..."
    }
  ]
}
```

- **`version`** is the version that first ships the change, a prerelease's included. A note covers
  a finding when it names its item and its version is one the upgrade crosses: above the version
  held to, and up to the version as it is. So a note written for an earlier removal of the same id
  does not cover a later one. A kit's notes are read in the kit's versions, the platform's in the
  platform's.
- **`item`**, or **`items`** for one change that takes several, such as an action and its labels:
  each as the finding names it, one of the kinds above.
- **`renamedTo`**, with one `item`: what it is called now. One that the kit or the platform as it is
  does not have is refused.
- **`note`**: what a customer does. A pull request's changelog, and a tag's job summary, carry it
  under "Upgrading" (step 6), so whoever installs the release reads it.
- **A notes file that cannot be read whole is refused:** a folder, a key a note does not have, a
  version that is not one, an unknown kind, a second note for the same item at the same version.
  Reached through a link, it stops the run. A note in range
  that covers nothing is said, not refused: an item removed and then put back between the two
  versions leaves one.

### Running it

```bash
npm run app-upgrade -- --since origin/staging/enterprise-grade-app
npm run app-upgrade -- business-apps/packages/payers-claims-demo --since 76fd666a1
```

`--since <ref>` compares every kit under `business-apps/packages/`, or those named, and the
platform, as the working tree has them, with what they were at the ref: `git archive` writes the
ref's copies to a scratch folder, so `git` and `tar` are needed beside Node: tried on macOS, run
by the workflow on Linux, and not tried on Windows. `--previous` needs neither. A kit the ref did
not have is new, held to nothing of its own; one the tree no longer has is said, and with `--json`
is listed as `gone`. A kit is held to the package of its name at the ref, wherever it was, so a
kit whose folder was renamed is held to what it was, and a kit moved into a folder another left is
not held to that one; `--place-at <ref> <package>` prints the place. `--previous <package>`
compares one kit with an export of it, and `--previous-platform <folder>` the platform with one
`--export <ref> <folder>` wrote. Exit 0 keeps every configuration, 1 does not, 2 is a command it
could not run.

**In the pipeline,** step 3 runs it given `--previous`, after the version rules, and refuses the
package on any finding: _the upgrade from 0.4.0 does not keep every customer configuration: 2
findings, listed above_. Given `--previous-platform` too, the platform's side. The workflow passes
both, from the same commit it holds the version to (section 8, "In CI"): the kit as it was, found
with `--place-at` so that a renamed folder is not a new package, and the platform `--export` writes
at that commit. So a pull request that removes an ID a kit names fails here, and the workflow runs
on a change to the platform's sources for that reason. The workflow's step, its fetch left out,
was run on this repository, 25 November 2026, against the staging branch (every kit kept) and
against payers 0.3.0's commit (payers kept by its note, which the summary carries under
"Upgrading"; the other kits new). On GitHub it runs on pull requests too: on one on 26 November
2026, each kit's upgrade was held to the staging commit it was based on. Its tag path has not run
there.

**Its controls:** `npm run app-upgrade:selftest` holds 51 negative controls and 12 sound ones. Each
negative one breaks the demo, or a copy of the platform's files, in one way, and must be refused
for its own reason: thirteen kinds of item removed or renamed; the four kinds of dangling name; four
layer changes, the component's requirements, a layout and a page provider moved, a contribution
disabled; seven about notes and versions (a note above the range, a note at the version held to, a
rename to nothing, a notes file that cannot be read whole, one that is a folder, a version raised too
little, another package's version); nine on the platform's side (a rule gone with no note, a rule
the kit still names, the menu's prefix, a descriptor's attribute, the defaults component renamed,
two sources gone, a platform version that cannot be read, a note with the version not raised); and
the command's own errors, a link to the platform's notes and a `registries.ts` that cannot load
among them. The sound ones are kept: unchanged; a menu entry for a platform page removed; a label
key the platform's catalogue has, dropped with its note; a removal and a rename with their notes; a
note that covers nothing; a platform removal with its note and its version; the same platform
twice. Seven run on a scratch git repository: `--since` on a clean tree, a queue removed, one kit's
folder renamed and another kit moved into it, a kit gone with `--json`, an unknown ref,
`--place-at`, and `--export` held to by `--previous-platform` with no source missing.
`npm run app-package:selftest` holds step 3 to
it: a menu entry removed at a patch is refused there, as is a rule the kit as it was named and the
platform as it is does not register; with a note and a minor it is built, and the changelog
carries the note. Each was seen failing: with the kit's findings, either bound of the notes'
range, the platform's findings, the version requirement, the catalogue's exemption, the dangling
page providers and types, the count of registered menu entries, the source check or a notes folder
taken out of the check, or a source taken out of `--export`, and with step 3's call to it taken
out of the pipeline, the controls that hold each go red.

**Run on the four kits,** 25 November 2026: against the staging branch, every configuration is
kept. Against each kit's version before, where it has one, it found two upgrades the version rules
had passed. Payers 0.4.0, from 0.3.0, removed the action `payers.claim.approve` and its three
labels, when approval moved into the claims review workflow; contracts 0.2.0, from 0.1.0, moved
the app's address from `contracts` to `contract-desk`. Each kit now has the note that says what to
change, and both are kept.

### On a server, before the install

The server half, built on 26 November 2026, is for an administrator about to install a package
over the version a running Nuxeo has. Given that server, it adds what only the server shows to the
offline findings for the upgrade from the version installed, and prints them as the offline half
does, each with its severity and what to do:

```bash
node scripts/app-upgrade-check.mjs business-apps/packages/payers-claims-demo --server https://<host>/nuxeo
node scripts/app-upgrade-check.mjs <the kit> --server https://<host>/nuxeo --previous <the kit as installed>
```

The address is the server's, with `/nuxeo`, as `app-package --model-server` takes it. `--previous`
is the package as installed, such as the kit at its tag; without it the package is held to itself,
which only the version installed may be. `--json` prints the report as data, with every read made.
[`scripts/app-upgrade-server.mjs`](../../scripts/app-upgrade-server.mjs) is the check.

**It only reads.** Every request is a `GET`, sent by one function, `guardedFetch`, which refuses
before anything is sent any other method, a body, another origin, an address holding a
percent-encoded slash, backslash, dot or semicolon, or a semicolon, which a proxy that decodes the
path would turn into a move up, and any address not on its list, `READS`; it never follows a
redirect. A name from the package or from an answer is put in an address only when it is letters,
digits, `_`, `.` and `-`, but for the schemas' names `/config/schemas` lists, which the content
model's reader encodes, and the guard then holds as it holds every address. The
report says how many reads it made, and `--json` lists each. The credentials are `NUXEO_USER` and
`NUXEO_PASS`, in the `Authorization` header only, never printed, over HTTPS, or HTTP to this
machine; it refuses to run when Node is told to send through the environment's proxy
(`NODE_USE_ENV_PROXY`), which would carry them there. It reads the content model as
`app-package --model-server` does (`scripts/nuxeo-content-model.mjs`), through the same guard, and
a page provider's parameters and search client as the Builder MCP server does
(`tools/builder-mcp/src/page-providers.ts`).

**It refuses a server it cannot identify,** exit 2:

- `/api/v1/me` does not answer as `NUXEO_USER`, the identity guard's judgement, or answers someone
  who is not an administrator: every count would be of what they may read;
- `/api/v1/management/distribution` lists no `org.nuxeo.agentic.core`, or not the kit's bundle, its
  `Bundle-SymbolicName`: the kit is not installed, and a first install needs no check;
- the version installed cannot be read, is read two ways that disagree, waits for a restart, is in
  a state the check does not know, or is two versions running at once. It is read from the package
  manager's listing, `GET /nuxeo/site/connectClient/packages/local?type=<the package's type>`, the
  page the Connect client serves an administrator, where the version in force is `running`; and
  from the app registry, whose listing gives `app.json`'s `packageVersion` to someone in one of the
  app's groups. The distribution lists the kit's bundle at 0.0.0: Nuxeo reads a bundle's version
  from a Maven `pom.properties`, which a kit's jar does not have. The listing is HTML, and its rows
  link to installing and removing a package: the check reads the page and follows nothing on it;
- the package is older than the version installed, or newer with no `--previous`, or `--previous`
  is another version;
- a layout the installed version's bundle serves, `/nuxeo/agentic-ui-config/layouts/...`, differs
  from the package it is held to, or is one the package does not have: it is another build of that
  version. Of the same version, `mp-install` skips the new build as unchanged
  ([administrator guide](administrator-guide.md), section 5).

**What it checks:**

| Check          | Read on the server                                                                                                                                | Found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Records        | NXQL counts, `/api/v1/search/lang/NXQL/execute`, with no filter, so trashed records are among them; the content model                             | **Error:** records of a type the upgrade removes; carrying a schema it removes, or one a type of the same name stops carrying; holding a value of a property it removes, or whose type changes, read from the XSD with its constraints set aside; of a type whose lifecycle in the new version does not have their state. A type the package appends to, such as `File`, is not the package's to remove. **Warning:** records holding a value an enumeration no longer allows; records in a state the lifecycle keeps only as a way in, with no transition to it, as claims made before payers 0.4.0 wait in `project`. The kit's note for the item, if it has one, is in the steps                                                                                                                             |
| Page providers | `/api/v1/search/pp/<name>` and its `execute`, with a queue's or a home figure's parameters; `/api/v1/management/page-providers`                   | **Error:** a page provider the package changes, as written, CDATA included, that the server does not answer, or answers without an aggregate both versions have, with the search client that answers it: the repository answers none. Said instead: an aggregate only the new version has, or one the new version moves to another class, answered after the upgrade; a page provider given a parameter a related list fills from its record, which is not run                                                                                                                                                                                                                                                                                                                                                  |
| Workflows      | `/api/v1/workflowModel`; NXQL, by `docri:modelId`                                                                                                 | **Error:** workflows neither done nor cancelled on a route model whose zip the package changes. The routing service replaces the model at the next start (the kit's workflow component says how), and a workflow keeps the nodes it was started with, as one started under payers 0.6.0 kept a supervisor's step that cannot be completed                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Layer          | `/nuxeo/agentic-ui-apps/layer.json`, `apps/<id>/layer.json` and `apps/<id>/layer/<path>`, as an administrator; `/api/v1/management/configuration` | **Error:** an override in force the new version's validator refuses, held as the server holds it (`validateDeploymentFile`): to the package's `app.json` and `actions.json`, the ids the deployment registers, `nuxeo.agentic.ui.layer.registered.*`, of which nothing else in the configuration is kept, and the content model the server will have, its own less the types, schemas and properties the upgrade removes, under the package's stand-in model. After the upgrade the registry serves the package's file instead. **Warning:** a draft the layout designer saved that does not fit, the app's summary listing a draft of a file no override replaces yet; a file an override or a draft replaces that the upgrade adds, changes or removes; an override made on another version of the kit's file |
| Vocabularies   | `/api/v1/directory/<name>`                                                                                                                        | **Error:** an entry of a CSV the package changes that the server's vocabulary has not, unless its `createTablePolicy` is `always`: Nuxeo loads the file when it makes the directory, and again at each start only with `always`, as its directory configuration says; not measured here. **Warning:** with `always`, entries an administrator added, which the next start drops                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Diagnostics    | The app registry's `diagnostics`; the distribution's `errors`                                                                                     | **Warning:** each error the server reports, for the app or its runtime, before the upgrade, so that a new one after it can be told                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

An error makes the exit code 1, as an offline finding does; a warning leaves it alone. Exit 2 is a
check not made: a count the server cannot make, a read of what a check weighs that fails, a
redirect or a connection that fails anywhere. A page provider's own answer is what its check
weighs, so its failure is a finding. Two reads only help, and are said when they fail: one of the
two sources of the version, and the page providers' search clients. A deployment layer that is
switched off is said, and so is each check with nothing to look at.

**Not seen:** whether a customer's own component started, which only `server.log`'s
`Component Loading Status` says, though a runtime error the distribution reports is a warning;
records of a schema or a type the package as installed does not define; workflows started on a
model an earlier upgrade replaced, whose `docri:modelId` names a model that is gone; a complex
property's values, which are not counted; the Admin Center's install path; and the upgrade itself,
which the server-side test below would install and check. The offline half reads a type the
package appends to, such as `File`, as one of its own, and asks a note of its removal: not mended
here.

**Its controls:** `npm run app-upgrade:server-selftest` runs the check, as a command, against a
stand-in Nuxeo on this machine that answers each read as a Nuxeo 2025 with the demo kit installed
does. It holds 48 negative controls and 18 sound ones: each finding, with its severity and exit code; each refusal; and the
guard called directly, refusing a `POST`, a body, a `DELETE`, another origin, an address it does
not read, the listing's install link, two encoded slashes, an encoded semicolon and a path that climbs out of the
server's address. The sound ones include the version installed checked against itself; an upgrade
that changes a page provider, a route model, a vocabulary and an overridden file with nothing left
behind; an enumeration widened; a type the package stops appending to; a page provider moved to
the index; an override naming a row action the deployment registers; and those that only warn.
After every run each request the stand-in saw must be a `GET` with the credentials, of an address
on a list the selftest writes apart from the check's own, one for one with the reads the report
lists, and neither the password nor the encoded header may be in what the check printed or in an
address. Each check taken out of the script, or turned to the wrong version or model, each refusal, the guard's method, encoded-path and address checks, the credentials header, the report's list of reads, the selftest's own list and the routing of `--server` turn their control red: 63 such changes, each seen failing. The workflow runs it beside the offline half's controls.

**Run on the local Docker Nuxeo,** 26 November 2026, read only, as its administrator: payers
0.6.1 against the 0.6.1 installed, the version read from the package manager, the registry showing
the administrator no app. Every configuration kept, exit 0: no record of a state the claim
lifecycle does not have, no page provider, route model or vocabulary changed, the deployment layer
switched off, and one warning, the error the registry already reports for the kit's action
`payers.claim.referToInvestigations`, whose operation the server's allow-list does not hold. The
package manager's file was the same, byte for byte, after the run. Since the version installed was
the version checked, that run read the identity, the version, the layouts, the content model, two
counts and the layer's switch. A second run, the same day, held payers 0.7.0, from the staging
branch, to the 0.6.1 installed, given as `--previous` from the commit before 0.7.0 merged: kept,
exit 0, with the same warning. It read that 0.7.0 replaces the route model `PayersClaimReview`,
whose zip changed, and counted no workflow running on the server's model, by its `docri:modelId`;
and that the server has no vocabulary `PayersAppealDecision` yet, which 0.7.0 adds. The package
manager's file was again the same after it. What neither run reached, the counts of what an upgrade
removes, a page provider run, a vocabulary's entries and the layer's files, has been run only
against the stand-in. The answers the stand-in gives were each read first from that server, by
hand and read only: `/me`, the distribution, the package manager's listing, the registry, the
layouts, the content model, an NXQL count, a page provider's definition and its `execute` with
aggregates, `/management/page-providers`, `/workflowModel`, a route model's document, a vocabulary,
`/management/configuration`'s two groups of properties, and the layer's export switched off. The
layer's files, with the layer on, were read from `LayerService.java`, not from a server.

### What it does not see, and what a server-side test would add

- **Only what a kit names stands for what a customer names.** The platform's side weighs the IDs
  the four kits name, as they were or as they are; a customer's own configuration may name any
  documented ID, and an ID no kit names can be removed without a note. Holding every documented ID
  to the same rule is a check on the platform's versions, not yet made.
- **Not weighed:** what nothing outside the kit can address: a home card, a queue's columns and
  facets, a card's or a field's id inside a layout, a label's text. Nor, yet, a kit's directories,
  its operation chains, its lifecycle states and transitions, which a customer's rule may name, a
  complex property's subfields, or a facet.
- **A server-side upgrade test**, which is the later step, would install the kit's version before
  and a customer's configuration package on a server, upgrade the kit and the platform package
  with `nuxeoctl mp-install`, and check what only a server shows. The server half above reads,
  before an install, what of this a running server already shows: the records, page providers,
  route models, vocabularies and deployment layer an upgrade would leave behind. It installs
  nothing, so what only an install shows is still this test's:
  - that the customer's component still starts, with no pending component, and that the served
    configuration, `bootstrap.json`, `manifest.json`, `layouts.json` and the app registry's
    listing and files, is the customer's, with the same contributions replaced or removed and no
    new error in the diagnostics;
  - that records made on the version before still open: a type renamed leaves its documents
    unreadable, a property removed leaves its data behind, and a lifecycle changed leaves a record
    in a state the new one keeps only as a way in, as payers 0.4.0's claims are;
  - that a route model replaced by its zip's digest, a vocabulary loaded from its CSV, and a page
    provider behind a queue all answer as the new version expects;
  - the Admin Center's install path, which no rehearsal here has covered.

## 11. A release candidate across all kits

Phase 10's first demo is a release-candidate tour across every kit
([development plan](development-plan.md), phase 10). `scripts/release-candidate.mjs` assembles the
candidate that tour would install, offline: no Nuxeo server, no credential, no signature, no tag and
no publishing. Built on 25 November 2026. On GitHub it runs on every push to a `staging/**`
branch ([in CI](#in-ci), below). The first, the merge of pull request #718 into
`staging/enterprise-grade-app`, was green, and so was every one since, but for the merges of #717
and #719, whose controls failed until #721.

```bash
npm run release-candidate -- --out ../release-candidate-2026.0.2 --since <the last release> --unsigned-kits
```

- **`--out`** is a directory that does not exist yet, in a folder that does, outside the
  repository: inside it, the next candidate's Maven tree would copy it, and under
  `business-apps/packages/` it would be read as a kit. A candidate never overwrites an earlier one:
  an existing path, folder or file, stops the run with exit 2 and is left as it was. A refused or
  interrupted run removes the directory it made, so no half-built candidate looks like a whole one,
  and its scratch folder.
- **`--since`** is the last release, any git ref: each kit is held to the package of its name as
  that commit has it, and to the platform there, as section 10's upgrade check reads them. A kit
  the commit does not have is new, and held to nothing; one it has that the candidate does
  not is listed as removed. A kit is released by its tag `app-package/<name>/<version>` (section 5),
  and none has been pushed yet, so for now no ref is every kit's last release.
- **`--version`** is the Maven modules' version and the `nuxeo-agentic-ui` package's. Left out, it
  is the root pom's without `-SNAPSHOT`: a release candidate carries the version it would be
  released as, because Nuxeo counts neither `2026.0.2-SNAPSHOT` nor `2026.0.2-rc.1` as meeting a
  kit's dependency on `nuxeo-agentic-ui:2026.0.2` (below). A package that keeps a version of its
  own keeps it: `nuxeo-agentic-assets` is 0.1.0, its `assets.package.version`.
- **`--signatures` or `--unsigned-kits`,** one of the two, or the command stops with exit 2.
  `--signatures` is a folder of the kits' signatures, as their tag builds made them,
  `<name>-<version>.zip.sig.json`, or the JSON lines `gh attestation download` writes, renamed so
  (section 9.1). Stage 2 holds each kit's zip to its own, against
  `business-apps/trusted-signers.json` or `--trusted-signers`: a kit with no signature, signed by
  no trusted signer, whose signature is over other bytes or for another version, or was made from a
  commit neither the candidate's history nor `origin/main` holds, a tag on a commit never merged,
  refuses the candidate. `main` is the one branch beyond the candidate's own that counts: a ruleset
  protects it, and none covers `staging/*`, so a commit there is merged only into the branch the
  candidate is built from. The build
  is reproducible, so a kit unchanged since its tag has the digest its signature names, and the
  signature verified is written beside the zip in `kits/`. A keyless signature is checked with
  `gh attestation verify`, which reads Sigstore's trusted root over the network unless
  `--trusted-root` gives it. `--unsigned-kits` takes kits with no signature instead, as every kit
  is until its first tag, and the manifest and the release note say so. The server packages are
  not signed by this pipeline (section 9).
- It needs the Node `.nvmrc` pins, 24, and refuses another, since the client is built with the Node
  that runs it; Maven with a JDK, `unzip`, git, `tar`, which the upgrade check's export uses, and an
  installed workspace (`npm ci`). It took about
  thirty seconds on a laptop whose Angular build cache was warm; on GitHub the job that assembles
  it took from 2 to 19 minutes on 25 November 2026. It has not been run on Windows, where Maven is
  a `.cmd` that Node starts only through a shell.
- **Its children get no token.** The GitHub Packages tokens, and `NUXEO_USER` and `NUXEO_PASS`, are
  taken out of the environment the pipeline, Nx, Maven's tests and git are started with.

### What it builds and checks

Each stage stops the run when it refuses, with exit 1, the cheap ones first.

| Stage                    | What is built, and what is refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2. Every kit             | Each folder under `business-apps/packages/`, through this pipeline's steps 1 to 6, with the platform version of `libs/platform` and, for a kit that names one, its deployment's allow-list, `deployment/build-allow-list.json`, as `app-packages.yml` passes it: without it every operation a kit's buttons run is refused. Held as `app-packages.yml` holds it: `--previous` the package of its name at `--since`, which the upgrade check's `--place-at` finds, and `--previous-platform` the platform there, which its `--export` writes. So a kit whose platform range leaves the candidate's platform out is refused at step 2, and at step 3 one whose version did not move as far as its changes need, or whose upgrade does not keep every customer configuration, on its side or the platform's (section 10). Given `--signatures`, a kit not signed by a trusted signer over the zip built here |
| 3. The kits as a set     | Read from the zips: no two kits contribute the same package name, app id, address (the id, for an app with none), queue, action, component, document type, facet, schema, lifecycle, a type's lifecycle, page provider, automation chain or scripted operation, directory, action filter, workflow, event listener, rights policy (`nuxeo-agentic-assets`), or layout of a type and mode. A server keeps one of each: the later replaces the earlier, or is refused. An extension point the check does not know is printed and written to the manifest as not compared                                                                                                                                                                                                                                                                                                                                    |
| 4. The demo steps        | Listed, not run (below). A steps file that names a kit and declares no `serverRun`, declares it for another kit, or needs a seed the kit does not have is refused: the listing would make the kit's demo look shorter than it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 5. The client            | `nx build nuxeo-ui --configuration=production --base-href=/nuxeo/agentic-ui/`, as `build-marketplace.yml` builds it, without Nx's cache. The Maven module `apps/nuxeo-ui` runs the same build with its own Node, v20.0.0, which Angular 22 refuses, so the candidate builds it with the Node that runs it, the pinned 24                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6. The server packages   | `mvn package` at the root, tests included, every module but `apps/nuxeo-ui`, in a scratch copy of the working tree (every file git does not ignore, since a module's tests may read beyond it, as `nuxeo-agentic-assets`' read the brand kit's policy): its Maven version set with `versions:set` and `@VERSION@` stamped into `package.xml`, as `build-marketplace.yml` does, so the repository's poms are never edited. The package that deploys the client must carry stage 5's bundle file for file and byte for byte: the assembly leaves a missing bundle out without a word, and Maven says `BUILD SUCCESS`. Unstamped, as a plain `mvn package` leaves it, the `nuxeo-agentic-ui` package's `package.xml` says `@VERSION@`, which Nuxeo reads as 0.0.0                                                                                                                                            |
| 7. The packages as a set | Every package's dependencies, server packages' and kits', are in the candidate at a version Nuxeo counts as meeting them; no two conflict (`<conflicts>`); and each package's target platform lies within the target platform of each package it depends on. That last rule is this candidate's: Nuxeo holds a package to the running platform alone, so a package claiming platforms its dependency does not install on fails only once it is installed on one of them                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Nuxeo's rules, not semver's.** A dependency `name:min` or `name:min:max` is met as Nuxeo Connect
meets it: `release-candidate-set.mjs` ports nuxeo-connect-client 1.8.3's `Version`,
`PackageDependency`, `PlatformVersion` and `PlatformVersionRange`, read from their bytecode, and the
selftest holds it to 60 cases those classes answered when run: 21 dependencies, 6 orders of two
versions and 33 target platforms. Three of them decide a candidate's
version: a snapshot is below its release, so is a classifier starting `rc`, `alpha` or `beta`, and
any other classifier, such as `build-marketplace.yml`'s `2026.0.2-PR-12-BUILD-3`, is above it.

### What it writes

| File               | What it is                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`    | Every artifact with its kind, name, version and SHA-256; the commit and every uncommitted path; `--since` and its commit; whether the kits were held to their signatures, and each kit's signature: who signed it, from which commit; each kit's app, address, platform range, dependencies and the version it was held to; what was not compared; the demo steps |
| `SHA256SUMS`       | Every file of the candidate, in the form `sha256sum -c SHA256SUMS` reads from `--out`                                                                                                                                                                                                                                                                             |
| `RELEASE-NOTES.md` | The server packages, with their target platforms and dependencies, and each kit with what changed in it since `--since`: the pipeline's changelog, or new                                                                                                                                                                                                         |
| `DEMO-STEPS.md`    | The demo steps a server run would execute                                                                                                                                                                                                                                                                                                                         |
| `client/`          | The production bundle, as the package deploys it, and its files' digests                                                                                                                                                                                                                                                                                          |
| `server/`          | Each module's jar, at the candidate's version, and each Nuxeo package Maven built                                                                                                                                                                                                                                                                                 |
| `kits/`            | Each kit's zip, checksum and changelog, as the pipeline wrote them, and, given `--signatures`, its signature as verified                                                                                                                                                                                                                                          |

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
`run` is not called. Today that lists seven files, four for the Payers kit and three for brand
assets; the contracts and facilities kits have no steps file, and the listing says so.

### In CI

[`release-candidate.yml`](../../.github/workflows/release-candidate.yml) runs the controls on a
pull request that touches the candidate or what its controls read, and the whole candidate on every
push to a `staging/**` branch.

- **Held to the commit before the push.** No kit has a release tag yet, so no commit is every kit's
  last release, and the job holds each kit to the commit before the push, as `app-packages.yml`
  holds a push: a kit whose version did not move with its changes is refused, and the release note
  lists what the push changed. A new branch, or a commit before that the clone cannot read, is held
  to `origin/main` instead, where no kit is yet, and the log warns. Nothing moves the job to a
  kit's release tag once one is pushed: that is a change to the workflow's step, by hand. A push
  whose run a later push cancelled is held to nothing of its own, as in `app-packages.yml`.
- **One secret, for the install only.** The client cannot be built without the `@hylandsoftware`
  packages, so `npm ci` reads the read-only `SATORI_GH_READONLY_TOKEN` in its own step, in both
  jobs, as ci.yml's jobs do. The candidate's step runs with no token and checks so, and the script
  takes every token out of what it starts. No signing key, Marketplace credential or write
  permission is in the workflow.
- **Unsigned kits, said so.** The workflow gives `--unsigned-kits`: a kit is signed by its tag's
  run in `app-packages.yml`, and no tag has been pushed. Once kits are signed, giving their
  signatures instead is a change to the workflow's step, by hand, as moving `--since` to a release
  is.
- **The record is uploaded, not the candidate.** The repository is public, so anyone signed in can
  download a run's artifacts, and the bundle carries the `@hylandsoftware` packages: uploading it
  would publish them. The run's artifact is the manifest, the checksums and the two notes, and the
  job's summary shows the notes.

### Its controls

`npm run release-candidate:selftest` breaks each check once and must see each refused:

- the dependency and platform cases Nuxeo answered;
- a package named twice, a dependency the candidate does not hold, one held at a snapshot, an
  `rc` or out of its range, a version never stamped, a conflict, and a target platform wider than
  its dependency's, of another name, or none;
- a deployed bundle with a file missing, one more, one of other bytes, or none at all, against the
  bundle that was built;
- a disabled or commented contribution, which registers nothing, and an unknown point, which is
  listed;
- two repository kits built by the pipeline and read from their zips, which share nothing, then
  one given the other's app id and one given the other's document type, which share exactly that;
- an output directory that exists, which is left as it was, one inside the repository, under
  `business-apps/packages/` or not, one whose folder is not there, which is not made, a
  `--since` that is no commit, `--out` given twice and a version a candidate cannot carry;
- a rename in `git status`, whose two names the manifest lists whole;
- a steps file with no declaration, one for another kit, and one needing a seed its kit does not
  have;
- a kit the pipeline built and a run-time key signed is taken; refused are one with no signature,
  one signed by a key no trusted signer has, one signed from a commit not in the candidate's
  history, one changed at the same version since it was signed, and another version's signature
  under its name; a signed commit in HEAD's history or on `origin/main` taken as merged, and one
  only on a staging branch, on a feature branch, or one git does not have, refused, in a
  repository of the control's own; and the command's neither `--signatures` nor
  `--unsigned-kits`, both, a `--signatures` that is no folder, trusted signers that name no
  signer, and `--trusted-signers` without `--signatures`, each exit 2. On the pinned Node with Maven, the command itself, given an empty `--signatures`, is
  refused at stage 2 for every kit, and removes its folder. Each was seen failing from the other
  side: the candidate's check broken to drop the version, to skip the folder's check, to take
  `--signatures` and `--unsigned-kits` together, to take any commit as merged, or a feature
  branch's, not to ask, and to refuse for another reason, each failed its control.

It builds no client and runs no Maven. Stage 6's other refusals, a Maven run that fails, a module
that builds nothing, a zip with no `package.xml`, and no package deploying the client, are reached
only by the command's own run; the last of them was seen failing below.

Run whole on 25 November 2026, on staging with `nuxeo-agentic-assets` merged, the command was green
held to `origin/main`, to the staging branch's tip, where it held all four kits to their versions,
and to an earlier staging commit, where it held three kits to the versions before and wrote their
changelogs. Each change below was made in place and put back after its run. Each run was refused
with exit 1 and its directory removed, for that one reason alone:

- the facilities kit given the Payers app's id, `payers-claims`, at stage 3;
- the facilities kit given the Payers kit's document type `Claim`, at stage 3;
- the brand assets kit depending on `nuxeo-agentic-assets:0.2.0`, at stage 7, which named the
  candidate's 0.1.0;
- `--version 2026.0.2-SNAPSHOT`, at stage 7, once for each of the four kits that depend on
  `nuxeo-agentic-ui:2026.0.2`;
- a label of the contracts kit changed with its version still 0.2.0, held to `HEAD`, at stage 2,
  by the pipeline's step 3;
- the contracts kit's migration note for its address made to name another, held to the commit
  where the kit was 0.1.0, at stage 2, by the upgrade check in the pipeline's step 3, which named
  the address `contracts` that 0.2.0 moved;
- `nuxeo-agentic-ui-package`'s assembly pointed at a folder the bundle is not in, at stage 6:
  Maven said `BUILD SUCCESS` and packaged no client, and the candidate said no package deploys it.

A second run into the first run's directory was refused with exit 2, and left its 82 files as they
were: `sha256sum -c SHA256SUMS` passed on every one.

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
- that the Marketplace's own checks pass, which need the credentials section 9.2 proposes. The
  kits' signatures are checked here, given `--signatures`; the server packages are not signed by
  this pipeline.

The first two, and the seeds, are what the [demo server](../../business-apps/demo-server/README.md)
would show once it runs: from a candidate's output directory, on a server it makes for the purpose,
one `nuxeoctl mp-install` of every package in dependency order, at one start, then the deployment's
configuration, the seeds, and the steps files' commands printed. Built on 25 November 2026, its
controls and its dry run run offline; it has not been run against Docker yet.
