---
name: app-builder
description: Build or change a Nuxeo Satori business app, an app definition package of version 2, with a presales engineer, against a development server. Read the server's model, page providers, workflows, vocabularies and operations through the Builder MCP server, write the files with the app generators, check them with the package pipeline, then preview what can be previewed and hand publishing to a person. Use when asked for an app, a record page, a queue or an action for a demo or an account, or to change a package under business-apps/packages/.
---

# Build a business app with the agent

Phase 3 of `docs/business-apps/development-plan.md`, the Builder kit: a presales engineer asks
for an app in plain words, and the agent writes the package, checks it, and shows it. The agent
writes configuration only. It never writes the data model of a customer's server, or code: the
types, schemas, page providers and lifecycles come from Studio or a model package, and are already
on the server. The one exception is a demo kit the person asks to carry a stand-in model, as the
Payers kit does: `app-model` writes it (step 2), fictional and kept in a component of its own.

What a package may hold: `docs/business-apps/package-pipeline.md`, section 1, and
`docs/business-apps/app-definition-v2.md`, section 1. What a record page may say:
`docs/business-apps/layout-v2.md`. The Payers kit, `business-apps/packages/payers-claims-demo`,
is the worked example.

## What exists today, and what does not

| Step                         | How                                                             | State                                                       |
| ---------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| 1. Read the server           | The Builder MCP server, `tools/builder-mcp`                     | Built: 11 read-only tools                                   |
| 2. Write the files           | The `app-*` generators, `app-model` for a demo's stand-in model | Built, in `tools/satori-generators`                         |
| 3. Check them                | `validate_package`, or `npm run app-package`                    | Built: the pipeline's steps 1 to 6                          |
| 4. Preview in dev mode       | `preview_package`, with `npx nx serve nuxeo-ui` running         | Built, on the local dev server. Not `app.json` or actions   |
| 5. Publish to pre-production | A person tags the merged commit; CI signs and publishes         | **Not built in the MCP server.** The tag path has never run |

Say this to the person at the start, and again when you reach steps 4 and 5. Do not describe a
step as done that this table says is not built.

## 0. Before you start

- **Node 24** (`.nvmrc`) and `npm ci` in the checkout. The MCP server needs `node_modules`.
- **A development server whose model you may share with the model the agent runs on.** Hyland's AI
  use requirements apply to everything the tools answer: it goes to the agent. Never point the
  tools at production, or at a server holding a customer's data you may not share.
- **Credentials from the environment only:** `NUXEO_USER` and `NUXEO_PASS`, which have no default.
  Never write them into a file, a command's arguments, a URL or a message.
- **Fictional data, and no account names.** The repository is public.
- **Register the MCP server once,** from the repository's root, in a shell that has the credentials
  exported (the single quotes keep the password out of the configuration):

  ```bash
  claude mcp add-json nuxeo-builder --scope local '{"type":"stdio","command":"node","args":["tools/builder-mcp/src/main.ts"],"env":{"NUXEO_URL":"${NUXEO_URL:-http://localhost:8080}","NUXEO_USER":"${NUXEO_USER}","NUXEO_PASS":"${NUXEO_PASS}"}}'
  ```

## 1. Read the server

Find out what is there before writing anything. Every name a package writes must exist on the
server or be registered in the platform; a guess is refused by the pipeline, or worse, passes and
shows nothing.

| To know                                           | Ask the MCP server, with its arguments             |
| ------------------------------------------------- | -------------------------------------------------- |
| which document types exist, and their schemas     | `get_content_model`                                |
| a type's fields, with their types, by schema      | `describe_document_type`, `{ "type": "Contract" }` |
| a schema's fields, and who uses it                | `describe_schema`, `{ "schema": "contract" }`      |
| which page providers exist, and which are indexed | `list_page_providers`, `{ "query"? }`              |
| a page provider's parameters, sorts, aggregates   | `describe_page_provider`, `{ "name" }`             |
| the vocabularies, and one's entries               | `list_vocabularies`, `get_vocabulary` `{ "name" }` |
| the workflows, a step's buttons and variables     | `list_workflows`, `describe_workflow` `{ "name" }` |
| an operation's parameters                         | `list_operations`, `describe_operation` `{ "id" }` |

- **The type the person names must exist.** If it does not, stop: creating it is Studio's, not
  yours. Say which types are there. Only when the person asks for a demo kit with a stand-in model
  of its own, write one with `app-model` (step 2), never on a server that holds a customer's model.
- **A page provider's `?` parameters are filled in order.** A queue has no open record, so a page
  provider that needs a parameter takes a literal; one for "my work" names the person on the
  server.
- **An indexed page provider lags a write** (`list_page_providers` marks them): a record created a
  second ago may not be listed yet.
- **An operation the server has is not one a package may name.** The deployment's allow-list says
  which, and the pipeline refuses every operation it is not given one for.

The generators and the pipeline also take the model as a file. Export one outside the repository,
or read it live with `--modelServer`:

```bash
npm run app-package:model -- --server http://localhost:8080/nuxeo --out /tmp/content-model.json
```

## 2. Write the files, with the generators

Run them from the repository's root. Never write `build.mjs`, `package.xml`, the manifest or the
component by hand: the generators write what the pipeline requires, byte for byte where it
requires that.

`--platform` in the commands below, and in what each generator says to run next, is the
platform's version: `node -p "require('./libs/platform/package.json').version"`, which CI and
`validate_package` pass too. It was `0.2.0` when this was written.

**The order depends on where the model is.** On a customer's server the types exist, so the first
example below holds: `app-package --type` writes the first record page from the model. **A demo
kit with a stand-in model** has no model until `app-model` writes one, and `app-model` needs the
package, so its order is:

1. `app-package` without `--type`;
2. `app-model --properties` for each type, then `app-model --pageProvider` for each page provider,
   with `--aggregates` for one whose queue has facets or whose home counts buckets;
3. `app-layout` and `app-form`, each given the kit's own model,
   `--model=business-apps/packages/<name>/content-model.json`;
4. `app-queue`, `app-action`, and the home and the menu by hand, then `app-registry`.

The tutorial, `docs/business-apps/tutorial.md`, follows that order for the facilities kit.

```bash
# The package, with its first record page from the model, and its app for the app registry
npx nx g ./tools/satori-generators:app-package acme-contracts --owner=acme --title="Acme Contracts" \
  --groups=contract-managers --type=Contract --model=/tmp/content-model.json

# Another record page; --modelServer=http://localhost:8080/nuxeo reads the model live instead
npx nx g ./tools/satori-generators:app-layout --package=business-apps/packages/acme-contracts \
  --type=Counterparty --model=/tmp/content-model.json

# The Edit form (--mode=create for the Create form), the fields it must have required
npx nx g ./tools/satori-generators:app-form --package=business-apps/packages/acme-contracts \
  --type=Contract --mode=edit --required=dc:title,contract:number --model=/tmp/content-model.json

# A queue, on a page provider describe_page_provider showed
npx nx g ./tools/satori-generators:app-queue --package=business-apps/packages/acme-contracts \
  --id=open-contracts --pageProvider=acme_open_contracts --columns=contract:number,dc:title,contract:end \
  --sort=contract:end

# A lifecycle button, on the record page and the queue's rows
npx nx g ./tools/satori-generators:app-action --package=business-apps/packages/acme-contracts \
  --id=acme-contracts.approve --transition=approve --on=record,row --type=Contract \
  --confirm="Approve this contract?" --queue=open-contracts

# After writing the home, the menu or a task form by hand: the app names every file it serves
npx nx g ./tools/satori-generators:app-registry --package=business-apps/packages/acme-contracts
```

What each writes, and what it leaves to you:

- **`app-package`:** `app.json`, `labels/en.json`, the component, `package/`, the manifest and the
  reviewed `build.mjs`, under `business-apps/packages/<name>/`, which CI checks on every pull
  request. The component contributes the app to the app registry, so "Switch app" can list it on
  a server. A package with no record page is refused by the pipeline's step 5, so give it
  `--type`, or, in a demo kit, write the first record page with `app-layout` once `app-model` has
  written the model.
- **The app's id and address.** `app-package` writes the address, where the shell is to open the
  app: its id unless `--address` gives another. It refuses one that is a platform route, as the
  pipeline refuses one written in `app.json`: `contracts`, `search`, `tasks` and the rest of
  `PLATFORM_ROUTES` in `libs/shared/app-definition`. For such an id, give `--address`, such as
  `--appId=contracts --address=contract-desk`. A package whose `app.json` has no address and whose
  id is one is only noted by the pipeline: fix it all the same.
- **`app-layout`:** one card per schema of the type, leaving out Nuxeo's own (`common`,
  `dublincore`, `uid`, `file`, `files`, `facetedTag`, `relatedtext`) unless `--schemas` names
  them. A widget only where the model says more than the type: `vocabulary` for a property bound to
  a directory, `document-link` for a document's id, `table` for a list of complex values,
  `address` for a complex value with a street and a city. Files are left out, and it says so. It
  has the component contribute the layout, from the one path the pipeline accepts.
- **`app-form`:** the Edit or Create form, as `app-layout` chooses its cards, `dc:title` first,
  and `"required": true` on the fields `--required` names. A widget only where it changes the
  input: `vocabulary`, a picker. A file, or a value holding one, is left out: files are changed in
  Attachments. The component contributes it, as it does the record page. A field rule in plain
  words is the next edit (below).
- **`app-queue`:** the page provider, columns, sort and page size. Nothing checks its columns
  against the model yet. Facets are the next edit, by hand: `"facets": [{ "aggregate": "<id>",
"labelKey": "<key>" }]`, each an aggregate the page provider defines, which
  `describe_page_provider` lists for a server's. The pipeline refuses a facet whose aggregate a
  page provider in the package's own model does not define.
- **`app-action`:** a transition or an operation (`--operation`, with `--parameters` as JSON), on
  `record`, `row` or `bulk`, and `--queue` to offer it there. An id starting `app.` or `core.` is
  the platform's, and refused.
- **`app-registry`:** the component's `<app>`, naming every file of the app definition the
  registry serves. `app-package` writes it, and `app-layout`, `app-form`, `app-queue` and
  `app-action` keep it in step; run it after writing a file by hand, or for a package that has
  none. It takes out a file the package no longer holds.
- **`app-model`, for a demo kit only:** a stand-in type with its schema, `--properties` such as
  `number,status=Draft|Active,value:double,end:date`, and page providers over it, `--pageProvider`
  with `--where` and `--sort`, in a model component of its own that the manifest lists first. A
  page provider reads the repository, which answers no aggregate; `--aggregates=<prefix>:<name>,...`
  writes it from the search index instead, with a terms aggregate `<prefix>_<name>_agg` for each
  property and the type's search document, so a queue's facets and a home's figures can name them.
  It writes `content-model.json` beside `bundle/`: give that to the other generators until a server
  has the package. The pipeline holds a package that ships a stand-in model to it by default.

  ```bash
  npx nx g ./tools/satori-generators:app-model --package=business-apps/packages/acme-contracts \
    --type=Contract --properties="number,status=Draft|Active|Terminated,value:double,end:date"
  npx nx g ./tools/satori-generators:app-model --package=business-apps/packages/acme-contracts \
    --type=Contract --pageProvider=acme_active_contracts --where="contract:status = 'Active'" \
    --sort=contract:end --aggregates=contract:status
  ```

Then edit what the generators wrote, as the person asks, following `layout-v2.md`:

- **Fields come in the order the server lists them,** not the schema's. Reorder them.
- **Pick the widgets a person would:** `currency` with its code, `status-badge` with its tones,
  `phone`, `email`, `relative-date`. A widget must show its property's type; the pipeline refuses
  one that does not, given the model.
- **Rules, computations and related records** are registered ids only (decision 4): no expression
  and no code. A field rule "in plain words" becomes `visibleWhen`, `required` or `readOnlyWhen`
  with a rule from `PACKAGED_REGISTRIES` in `libs/shared/app-definition`. `required` and
  `readOnlyWhen` are for forms: write the form with `app-form` first. If no rule says it, tell the
  person; do not invent one.
- **Sensitive fields.** Ask before showing an identifier such as a social security number. Hiding a
  field with a rule is a convenience, not a control: the server still returns it to anyone who may
  read the record.
- **The menu and the home** (`navigation.json`, `home.json`) have no generator: write them by hand,
  from `app-definition-v2.md`, sections 9 and 10, then run `app-registry`, so that the app names
  them.

## 3. Check them, after every write

```bash
npm run app-package -- business-apps/packages/acme-contracts --platform 0.2.0 --model /tmp/content-model.json
```

The MCP server's `validate_package` runs the same pipeline on the folder, as CI does. It takes no
content model: a package that ships a stand-in model is held to its own `content-model.json`, in
both, and a package on a customer's server to none. So for a customer's package, use it for the CI
view, and the command above for the model. Both must pass before you say anything works.

- **Give it the server's model.** Without one, in a package that has no stand-in model, a field
  the type does not have and a widget that does not fit its property both pass. With `--model` or
  `--model-server`, they are refused.
- **Every `labelKey` needs a text,** in the package's `labels/en.json` or the platform's catalogue:
  the pipeline refuses one with neither, naming the key and the file. Add the text when you write
  the key, not at the end.
- **Give it the allow-list** when the package has an operation: `--allow-list <file>`, a file of
  `{ "operations": [...] }`; `validate_package` takes one as `allowList`, inside the repository.
  CI passes none yet, so a package with an operation fails CI until
  decision 3 settles where the allow-list lives. Say so.
- **Read the findings, then fix the file.** Each names the file, the place and the reason, such as
  `cards[0].fields[1].widget: the widget "calendar" is not registered [unknown]`. Never weaken a
  check, rename an id to something unregistered, or run the pipeline without the model to get a
  pass.
- **What it does not check yet** (`package-pipeline.md`, section 7): that a page provider exists,
  a facet's aggregate on a page provider of the server's, a queue's or a related list's columns,
  the properties a rule or a computation names, and a vocabulary widget's directory against its
  property's. Check those by reading the server.

## 4. Preview in dev mode, as far as it goes

`preview_package` validates the package, then serves it to the local development server through
`config:dev`, and answers with the addresses to open. Start the dev server first, once; if
`apps/nuxeo-ui/public/agentic-ui-config/` did not exist when it started, the answer says to restart
it:

```bash
npx nx serve nuxeo-ui
```

Then call `preview_package` with the package folder, as `validate_package`. Read the answer:

- **`served`**: false when the pipeline refused the package; its findings are in `validation`.
- **`open` and `pages`**: the home, each queue, the tasks page, under `http://localhost:4200/#/`. A
  record page opens on a record of its type: from a queue, a search, or `#/doc/<id>`.
- **`notServed`**: what the dev server cannot show, and why: `app.json`, `actions.json`, `modules/`,
  `assets/`.
- **`devServer`**: whether it answers every file as written. Tell the person when it is not
  running, or must be restarted.
- **Each preview replaces the last.** Say so when the person had something else served.

The person signs in to the app with their own account, on the Nuxeo server the dev server proxies
to. A server in dev mode could preview the layouts only, by hand (`tools/builder-mcp/README.md`,
"Previewing a package"): never write to a server or a container without the person's go-ahead.

- **Drawn:** a record page from each `view` layout, its related lists included, and the home.
  What the record page leaves out is in `layout-v2.md`, section 11, and said in the browser's
  console. The ones a scaffold meets:
  - **Card headings from the labels.** The generators name each card with a `labelKey`, and a key
    shows only where a labels file the app reads has a text for it: the preview serves the
    package's labels, and on a server the app registry does, since the package contributes its
    app. A literal `label` wins over the key.
  - **`document-link` shows the stored id,** and `image` and `file-list` a file's name, until each
    has its lookup.
  - **A record with a file or a note** (a `File`, a `Note`, or any type given the `file` or `note`
    schema) keeps its own view and preview, not the record page.
- **Not drawn at all yet:** the package's actions (`actions.json` is carried, not read),
  `app.json`, and module settings.
- **The records must exist on the server,** with the types the package names. Seeding them is the
  kit's (the Payers kit has `demo/seed.mjs`), with fictional data.
- **Installing the package into a Nuxeo** is the person's decision: ask before installing anything
  into a server or a container. The Payers kit's README, "Installing it on a local Nuxeo", shows how
  on the local Docker one.

## 5. Publish to pre-production: a person's step

The MCP server has no publish tool, and promotion after a person approves is a proposal, not built
(`package-pipeline.md`, sections 5 and 9). Today:

1. The person raises the version in `package/package.xml`, `app.json`'s `packageVersion` and the
   manifest's `Bundle-Version`, together, as far as the changes need (`package-pipeline.md`,
   section 8: a removed queue, layout or label key needs a major, from 1.0.0), and the pull
   request merges. Its check refuses a version that moved less.
2. The person tags the merged commit `app-package/<name>/<version>` and pushes the tag.
3. The workflow `app-packages.yml` checks and builds it again, attests it and publishes it to
   Marketplace preprod. This path has not run yet.

**Never push an `app-package/*` tag yourself**, and never present the package as published: say
what is left for the person.

## Done means

- the pipeline passes with the server's model, and with the allow-list when there is an operation;
- every id the package names is registered, or is the package's own;
- the person has seen the record pages in the preview, or has been told why not;
- the reply lists what is not shown yet and what is left for a person: installing, publishing.

## What this skill does not do

- Write document types, schemas, page providers or lifecycles: Studio's.
- Write Angular or any other code: a package is configuration only.
- Change the generators, the validator or the pipeline to make a package pass. A refusal is the
  answer; fix the package.
