---
name: app-builder
description: Build or change a Nuxeo Satori business app, an app definition package of version 2, with a presales engineer, against a development server. Read the server's model, page providers, workflows, vocabularies and operations through the Builder MCP server, make every write to the package through its write tools, which run the app generators and commit a change only when the package pipeline passes it, then preview what can be previewed and hand publishing to a person. Use when asked for an app, a record page, a queue or an action for a demo or an account, or to change a package under business-apps/packages/.
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

| Step                         | How                                                                   | State                                                                 |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. Read the server           | The Builder MCP server, `tools/builder-mcp`                           | Built: 11 read-only tools                                             |
| 2. Write the files           | `apply_generator`, `write_package_file` and `apply_package_changes`   | Built: each writes only what passes the pipeline, as CI runs it       |
| 3. Check them                | Each write checks first; `npm run app-package` with the model as well | Built: the pipeline's steps 1 to 6. The write tools take no model yet |
| 4. Preview in dev mode       | `preview_package`, with `npx nx serve nuxeo-ui` running               | Built, on the local dev server. Not `app.json` or actions             |
| 5. Publish to pre-production | A person tags the merged commit; CI signs and publishes               | **Not built in the MCP server.** The tag path has never run           |

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

- **A demo kit's own model is the package's, not the server's,** until the kit is installed. Give
  `get_content_model`, `describe_document_type`, `describe_schema`, `list_page_providers` and
  `describe_page_provider` the kit's folder as `package`, such as
  `{ "name": "moves_open_claims", "package": "business-apps/packages/moves-demo" }`: when the
  package ships a stand-in model, they answer from its `content-model.json` and its components,
  with `source: "package"`; what it does not have, the server answers, with `source: "server"` and
  a `packageNote` saying why.
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

The generators and the pipeline also take the model as a file. The write tools read one inside
the repository only, so export a customer's into the checkout's `tmp/`, which git ignores, and
never commit it:

```bash
npm run app-package:model -- --server http://localhost:8080/nuxeo --out tmp/content-model.json
```

## 2. Write the files, through the write tools only

**Every write to a package goes through the Builder MCP server's write tools.** Never write a
package file with your own file tools, a shell command or `npx nx g`: those write whatever they
are given, and the write tools write only what passes the pipeline.

| To write                                              | Call                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| one file of the app definition, whole                 | `write_package_file`, `{ "package", "path", "content" }`                        |
| what a generator writes                               | `apply_generator`, `{ "package", "generator", "options" }`                      |
| several steps that would each be refused on their own | `apply_package_changes`, `{ "package", "changes": [...] }`, all written or none |

Each makes the change to a staging copy, runs the pipeline's steps 1 to 6 on it as CI does, and
writes to the package only when there is no finding. Read the answer every time:

- **`written: true`:** the package now holds `changes`, and passes as CI runs it, on the files it holds here (CI checks only what is committed). Read its `warnings`, when there are any, and fix what they name: no check refuses it, but the package is not done.
- **`written: false`:** nothing was written. `validation.findings` and `validation.refusedAt` say
  why. Fix what they name and write again. An id the platform or the package does not register (a
  widget, a rule, an operation the allow-list does not name) is refused here, at write time: never
  rename it to something else unregistered, and never invent one. Tell the person what is not
  there.
- **An error:** the request was refused before anything ran, and the message says why: a path
  that leaves the package, a link, a file these tools do not write, a generator option they do not
  take. Do not work around it with your own file tools. The build allow-list,
  `deployment/build-allow-list.json`, is the deployment's: say so, and leave it to a person.

The package is one folder directly inside `business-apps/packages/`, or inside the folders the
server's `BUILDER_PACKAGE_ROOTS` names. `write_package_file` writes `app.json`, `home.json`,
`navigation.json`, `actions.json`, `queues/<id>.json`, `labels/<language>.json`,
`tasks/<workflow>.<step>.layout.json` and `layouts/<Type>/<mode>.layout.json`, under
`bundle/agentic-ui-config/`, each a JSON object of `"version": 2`. The generators write the rest:
`build.mjs`, `package.xml`, the manifest and the component, byte for byte where the pipeline
requires it. The options are those of the generator's schema, by name, as `npx nx g` takes them;
the tool gives `package` (and `app-package`'s name and directory) from its `package` argument.
`modelServer` is refused: a generator would send the credentials to the address it is given.

**The order depends on where the model is.** On a customer's server the types exist, so the first
example below holds: `app-package` with `type` writes the first record page from the model. **A
demo kit with a stand-in model** has no model until `app-model` writes one, and `app-model` needs
the package, so its order is:

1. `app-package` without `type`;
2. `app-model` with `properties` for each type, then with `pageProvider` for each page provider,
   with `aggregates` for one whose queue has facets or whose home counts buckets;
3. `app-layout` and `app-form`, each given the kit's own model,
   `"model": "business-apps/packages/<name>/content-model.json"`;
4. `app-queue`, `app-action`, and the home and the menu with `write_package_file`, then `app-registry`, in one call.

The pipeline refuses a package with no record page, so steps 1 to 3 go in one
`apply_package_changes` call: alone, the first two would be refused, and nothing written. So does
a hand-written file the component must name, with the `app-registry` that names it. The tutorial,
`docs/business-apps/tutorial.md`, follows that order for the facilities kit.

```jsonc
// apply_generator: the package, with its first record page from the model, and its app for the
// app registry
{ "package": "business-apps/packages/acme-contracts", "generator": "app-package",
  "options": { "owner": "acme", "title": "Acme Contracts", "groups": "contract-managers",
               "type": "Contract", "model": "tmp/content-model.json" } }

// apply_generator: another record page
{ "package": "business-apps/packages/acme-contracts", "generator": "app-layout",
  "options": { "type": "Counterparty", "model": "tmp/content-model.json" } }

// apply_generator: the Edit form ("mode": "create" for the Create form), the fields it must have
{ "package": "business-apps/packages/acme-contracts", "generator": "app-form",
  "options": { "type": "Contract", "mode": "edit", "required": "dc:title,contract:number",
               "model": "tmp/content-model.json" } }

// apply_generator: a queue, on a page provider describe_page_provider showed
{ "package": "business-apps/packages/acme-contracts", "generator": "app-queue",
  "options": { "id": "open-contracts", "pageProvider": "acme_open_contracts",
               "columns": "contract:number,dc:title,contract:end", "sort": "contract:end" } }

// apply_generator: a lifecycle button, on the record page and the queue's rows
{ "package": "business-apps/packages/acme-contracts", "generator": "app-action",
  "options": { "id": "acme-contracts.approve", "transition": "approve", "on": "record,row",
               "type": "Contract", "confirm": "Approve this contract?", "queue": "open-contracts" } }

// apply_package_changes: the home written with write_package_file, and the app-registry that names it
{ "package": "business-apps/packages/acme-contracts", "changes": [
    { "kind": "write", "path": "bundle/agentic-ui-config/home.json", "content": "{ ... }" },
    { "kind": "generator", "generator": "app-registry" } ] }
```

What a generator prints, such as the command to run next, comes back as `generatorOutput`. Its
`--platform` is the platform's version, `node -p "require('./libs/platform/package.json').version"`,
which CI and the write tools pass too. It was `0.2.0` when this was written.

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
  `address` for a complex value with a street and a city. Files are left out. Its "Left out" names
  every property it did not write and why, Nuxeo's own schemas' included, such as `files:files`,
  a record's attachments, which the document page's Attachments panel shows. It has the component
  contribute the layout, from the one path the pipeline accepts. `app-form` says what it left out
  the same way.
- **`app-form`:** the Edit or Create form, as `app-layout` chooses its cards, `dc:title` first,
  and `"required": true` on the fields `--required` names. A widget only where it changes the
  input: `vocabulary`, a picker. A file, or a value holding one, is left out: files are changed in
  Attachments. The component contributes it, as it does the record page. A field rule in plain
  words is the next edit (below).
- **`app-queue`:** the page provider, columns, sort and page size. The pipeline holds the columns
  and the sort, and a related list's, to the type a page provider of the package's own lists, as
  its NXQL says (`ecm:primaryType = '<Type>'`, as `app-model` writes it), given a content model,
  as a demo kit's own always is; on the server's, or with no model, nothing checks them. Facets
  are the next edit, with `write_package_file`: `"facets": [{ "aggregate": "<id>",
"labelKey": "<key>" }]`, each an aggregate the page provider defines, which
  `describe_page_provider` lists for a server's. The pipeline refuses a facet whose aggregate a
  page provider in the package's own model does not define.
- **`app-action`:** a transition or an operation (`--operation`, with `--parameters` as JSON), on
  `record`, `row` or `bulk`, and `--queue` to offer it there. An id starting `app.` or `core.` is
  the platform's, and refused.
- **`app-registry`:** the component's `<app>`, naming every file of the app definition the
  registry serves. `app-package` writes it, and `app-layout`, `app-form`, `app-queue` and
  `app-action` keep it in step; run it in the same call as writing such a file with `write_package_file`, or for a package that has
  none. It takes out a file the package no longer holds.
- **`app-model`, for a demo kit only:** the write tools refuse it on a package that does not ship its own `content-model.json` already, unless the same call makes the package. A stand-in type with its schema, `--properties` such as
  `number,status=Draft|Active,value:double,end:date`, and page providers over it, `--pageProvider`
  with `--where` and `--sort`, in a model component of its own that the manifest lists first.
  `--attachments`, with `--properties` when the type is first written, gives it Nuxeo's `files`
  schema too, `files:files`, where the document page's Attachments panel adds a record's files. A
  page provider reads the repository, which answers no aggregate; `--aggregates=<prefix>:<name>,...`
  writes it from the search index instead, with a terms aggregate `<prefix>_<name>_agg` for each
  property and the type's search document, so a queue's facets and a home's figures can name them.
  It writes `content-model.json` beside `bundle/`: give that to the other generators until a server
  has the package. The pipeline holds a package that ships a stand-in model to it by default.

  ```jsonc
  // Two changes of one apply_package_changes call, after app-package and before app-layout
  { "kind": "generator", "generator": "app-model",
    "options": { "type": "Contract", "properties": "number,status=Draft|Active|Terminated,value:double,end:date" } }
  { "kind": "generator", "generator": "app-model",
    "options": { "type": "Contract", "pageProvider": "acme_active_contracts",
                 "where": "contract:status = 'Active'", "sort": "contract:end",
                 "aggregates": "contract:status" } }
  ```

Then edit what the generators wrote, with `write_package_file`, as the person asks, following
`layout-v2.md`. Write the whole file each time, starting from what the package holds now:

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
- **The menu and the home** (`navigation.json`, `home.json`) have no generator: write them with `write_package_file`,
  from `app-definition-v2.md`, sections 9 and 10, in one `apply_package_changes` call with the
  `app-registry` that has the app name them. Written alone, a new one is refused.

## 3. Check them: every write already did

Each write tool ran the pipeline's steps 1 to 6 on the package as it would be, as CI runs them,
before writing it: a package that ships a stand-in model held to its own `content-model.json`, one
with `deployment/build-allow-list.json` to that allow-list, and nothing else given. So after a
write that answered `written: true`, the package passes as CI runs it. Two checks are still yours:

```bash
npm run app-package -- business-apps/packages/acme-contracts --platform 0.2.0 --model tmp/content-model.json
```

- **Give the pipeline the server's model.** The write tools, like CI and `validate_package`, give
  a package on a customer's server no model, so a field the type does not have and a widget that
  does not fit its property both pass them. With `--model` or `--model-server`, the command above
  refuses them. For a customer's package, both must pass before you say anything works.
- **`validate_package` checks a package as it is,** such as one a person changed by hand.
- **Every `labelKey` needs a text,** in the package's `labels/en.json` or the platform's catalogue:
  the pipeline refuses one with neither, naming the key and the file. Write the text in the same
  call as the key: `apply_package_changes`, the labels first.
- **Name each of the kit's own schemas for the Properties panel:** `layout.schema.<schema>`, by the
  schema's name, not its prefix, in `labels/en.json`. For a type with no `metadata` layout the panel
  heads each schema's section with it, else with the name made readable, `acmeproduct` as
  "Acmeproduct". `app-model` writes it for each type it writes, from the type's name, "Damage
  claim"; change the text with `write_package_file` if the person names the schema otherwise. The
  pipeline does not ask for it, but a write that leaves one of a kit's schemas without it answers
  `written: true` with `warnings` naming the key; `kit-schema-labels.spec.ts`, in
  `libs/shared/document-layouts`, fails a kit under `business-apps/packages/` without it.
- **A new kit under `business-apps/packages/` joins two lists outside its folder.** Run
  `npm run app-definition:server-validator`, which rebuilds the server validator's parity corpus
  from every kit folder, and give the kit its rows in `docs/business-apps/administrator-guide.md`:
  section 1's table of packages, the table of the app registry's groups, and a link to its README.
  `kit-lists.spec.ts`, in `libs/shared/app-definition`, fails a kit missing from either.
- **The allow-list is the deployment's.** A package with an operation passes only against the
  allow-list it names, `deployment/build-allow-list.json`, which the write tools never write and
  which CI gives the pipeline. A package with none is refused at write time for every operation:
  say so, and leave the allow-list to a person (decision 3).
- **Read the findings, then fix the file.** Each names the file, the place and the reason, such as
  `cards[0].fields[1].widget: the widget "calendar" is not registered [unknown]`. Never weaken a
  check, rename an id to something unregistered, write the file some other way, or run the
  pipeline without the model to get a pass.
- **A page provider's NXQL is checked for what Nuxeo refuses, not validated.** For a page
  provider the package defines, such as one `app-model --where` wrote, the write is refused for a
  construct Nuxeo's grammar has no place for: `BETWEEN NOW(...)`, for which compare with `>=` and
  `<=`, a string or a parenthesis left open, `==`, `&&`. A query it passes may still be refused
  on install: run it read-only on the development server first, as a search.
- **What it does not check yet** (`package-pipeline.md`, section 7): that a page provider exists,
  a facet's aggregate on a page provider of the server's, a queue's or a related list's columns
  and sorts on a page provider of the server's (on the package's own, whose NXQL names its type as
  `app-model` writes it, they are held to that type, given a model), the properties a rule or a
  computation names, and a vocabulary widget's directory against its property's. Check those by
  reading the server.

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
  record page opens on a record of its type: from a queue, a search, or `#/doc/<id>`. Each layout
  is named by its mode: the record page, its Properties panel, the Edit form, the Create form.
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
   request merges. Its check refuses a version that moved less. The write tools do not write
   `package.xml` or the manifest by hand, and do not compare with the version before.
2. The person tags the merged commit `app-package/<name>/<version>` and pushes the tag.
3. The workflow `app-packages.yml` checks and builds it again, attests it and publishes it to
   Marketplace preprod. This path has not run yet.

**Never push an `app-package/*` tag yourself**, and never present the package as published: say
what is left for the person.

## Done means

- every write to the package went through `write_package_file`, `apply_generator` or
  `apply_package_changes`, and the last answered `written: true`;
- the pipeline passes with the server's model, and with the allow-list when there is an operation;
- every id the package names is registered, or is the package's own;
- the person has seen the record pages in the preview, or has been told why not;
- the reply lists what is not shown yet and what is left for a person: installing, publishing.

## What this skill does not do

- Write document types, schemas, page providers or lifecycles: Studio's.
- Write Angular or any other code: a package is configuration only.
- Change the generators, the validator or the pipeline to make a package pass. A refusal is the
  answer; fix the package.
- Write a package any way but the write tools, or write its `deployment/` allow-list, its assets
  or its code.
