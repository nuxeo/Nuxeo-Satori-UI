# The package pipeline: its first stage

Phase 0 of the [development plan](development-plan.md) builds the package pipeline's first stage:
validate, sign, publish to pre-production. Phase 3 completes it, with versions, signatures and
promotion after a person approves.

Status: built on 22 November 2026, and not yet run in full. The checks run on every pull request;
signing and publishing run only for a tag, and no tag has been pushed yet.

## The short version

- **Checked on every pull request, with Node and `unzip` alone.** A package that names a widget
  the platform does not have fails, and the log names the file, the place and the widget.
- **Signed and published only when someone tags it.** The tag goes on a merged commit, and the
  package goes to Nuxeo Marketplace preprod, as the platform's own package does.
- **A package's own code never runs where the secrets are.** The job that holds them only checks,
  signs and publishes the zip the first job built.
- **Held to the server's content model, when it is given one.** With `--model`, a model file
  exported from a server, a layout whose widget does not show its property's type is refused, and
  so is a field whose property the type does not have. It is opt in: with no model, these pass.

## 1. What an app definition package is

It is a configuration package, as version 1 builds them
([extension-reference.md](../extension-reference.md), section 1): `bundle/`, `package/` and the
generator's `build.mjs`. What is new is in `bundle/agentic-ui-config/`, the app definition's
root: `app.json`, and the other files of [app-definition-v2.md](app-definition-v2.md), section 1.

- **What a server reads from it today:** its layouts, which the component XML contributes as
  version 1's are. A version 2 layout sits where version 1's does, and its view mode is new, so an
  app that reads only version 1 never asks for it.
- **What it carries for later:** `app.json`, the queues, actions and labels. Nothing contributes
  them yet; the app registry in `nuxeo-agentic-core`, also phase 0's, will.
- **No bootstrap fragment.** On a server that runs several apps, a bootstrap fragment would
  rebrand every one of them. An app's branding is in its `app.json`. The pipeline does not check
  this yet.

The demo is [`business-apps/packages/payers-claims-demo`](../../business-apps/packages/payers-claims-demo/README.md),
with fictional data.

## 2. The steps

`scripts/app-package.mjs` runs steps 1 to 6 on one package, each stopping the run when it fails.
It first removes the zip and checksum an earlier run left for the package's name and version, so
a refused package leaves nothing installable behind, not even an older zip that looks current.
The workflow, [`app-packages.yml`](../../.github/workflows/app-packages.yml), runs it on every
package, and runs steps 7 and 8 for a tag.

| Step              | What is checked or done                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The builder    | The package's `build.mjs` is the generator's, byte for byte, so the code that builds it is code this repository reviewed                                                                                         |
| 2. The definition | `bundle/agentic-ui-config/` has an `app.json`, and the validator finds nothing, given the deployment's allow-list, what it registers, its platform version and, when one is given, its content model (section 4) |
| 3. The version    | `app.json`'s `packageVersion` is `package.xml`'s version, and the tag, when publishing, is `app-package/<name>/<version>`                                                                                        |
| 4. The build      | `build.mjs` writes the zip, refusing what the server would refuse                                                                                                                                                |
| 5. The zip        | `verify-package-zip.mjs` finds a well-formed Nuxeo Package. A zip it refuses is removed                                                                                                                          |
| 6. The checksum   | The zip's SHA-256, beside it, in the form `sha256sum -c` reads. The build is reproducible, so the same source gives the same digest                                                                              |
| 7. Signed         | A build provenance attestation: GitHub's Sigstore attests that this repository's workflow built this zip from this commit                                                                                        |
| 8. Published      | Nuxeo Marketplace preprod, through the same `nos-publish` step `build-marketplace.yml` uses                                                                                                                      |

Steps 1 to 6 need no install and no credential, only Node 24, as `.nvmrc` pins, and the system's
`unzip`, which step 5 reads the zip back with. The one exception is opt in: a content model read
live from a server needs that server's credentials (section 4). The validator runs from its TypeScript through
`libs/shared/app-definition/src/bin.mjs`. The XML of `package.xml` and of the component is read by
`verify-package-zip.mjs`'s helpers, the builder's own grammar, ported.

Step 2 also holds the component to what the validator read: every layout it contributes comes from
`agentic-ui-config/layouts/<Type>/<mode>.layout.json`, in the mode its path names. One written
inline, or contributed from another file or in another mode, is refused, because the server serves
what the component says. It finds the components as the builder, the verifier and the server do:
the `Nuxeo-Component` headers of the manifest's main section, in any letter case, and it checks
those of every such header. A manifest that names them in more than one header, or spells the
header another way, is the builder's to refuse, at step 4: the server would load only the last.

## 3. Running it

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0
```

It writes `dist/payers-claims-demo-0.1.0.zip` and its `.sha256` in the package. `--out` puts them
elsewhere. `--allow-list` and `--registered` pass the deployment's to the validator, and
`--platform` its platform version; the workflow passes the version of `libs/platform`. `--model`
and `--model-server` give it the server's content model (section 4).

Its negative controls break a copy of the demo package in one way each, and every one must be
refused at its own step, for its own reason, with no zip left:

```bash
npm run app-package:selftest
```

## 4. The content model

The validator checks a layout against itself and the registries. Only the server's content model
says what each document type's properties are, so the pipeline holds layouts to it only when it is
given one ([layout-v2.md](layout-v2.md), sections 3 and 11):

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
- **The demo's model,** `content-model.json` beside the package, is fictional, as the package is.
  The negative controls hold the demo to it: a widget that does not fit, a property the type does
  not have, a table column naming a missing subfield, and a type the model does not have are each
  refused at step 2. The same broken layout with no model is built, which shows that it is the
  model that refuses it. A malformed model, and a server that refuses a read, each exit 2. A fake
  server answering as Nuxeo does proves the live read and the export: the credentials arrive on
  every read, each schema is read with `fetch-schema: fields`, a model whose property the widget
  does not fit refuses the layout, and the exported file is the model the server answered. Run
  against a local Nuxeo server, the export read 60 types, 65 facets and 98 schemas, with the
  directories bound to `dc:coverage` and to each item of `dc:subjects`.

## 5. Publishing a package

1. Raise the version in `package/package.xml` and `app.json`'s `packageVersion`, together, and
   merge.
2. Tag the merged commit `app-package/<name>/<version>`, and push the tag.
3. The workflow checks and builds the package again at that commit, signs the zip and publishes
   it.
4. Anyone can check the signature:

   ```bash
   gh attestation verify payers-claims-demo-0.1.0.zip --repo nuxeo/Nuxeo-Satori-UI
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
  check it. Phase 3 completes signatures, for instance by checking them when a package installs.
- **The first publish of a new package name** may need it registered on Nuxeo Connect's staging
  environment first. Not checked.
- **Who may publish:** anyone who can push a tag. A ruleset can restrict `app-package/*` tags, and
  none does yet.
- **Promotion to production after a person approves, and versions:** phase 3. A GitHub
  environment with required reviewers can hold the publishing job then.
- **The allow-list** is the deployment's (decision 3). Until it exists, the workflow passes none,
  and every operation is refused.
- **Where kits live:** under `business-apps/packages/` for now. Version 1's configuration packages
  moved to nuxeo/Nuxeo-Satori-Config; whether kits follow them, calling this pipeline from there,
  is open.
- **Not exercised yet:** steps 7 and 8, which run only for a tag.
- **The workflow passes no content model.** A package that carries its model could be held to it
  on every pull request; whether kits commit their server's model, and where, is open.
- **A facet a record gains at run time.** A field whose property only such a facet brings is
  refused when a model is given, and the message names the facet. The record page shows it on a
  record that has the facet. Whether the pipeline should accept it, perhaps when a rule shows the
  field only on records with that facet, is open.
- **Not held to the model yet:** a related list's columns, which are other records'; a queue's
  columns; the properties a computation, a rule or a widget parameter names; a task form's fields;
  and a vocabulary widget's `directory` against the one its property is bound to.
