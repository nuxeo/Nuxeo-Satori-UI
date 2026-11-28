---
name: satori-app-builder
description: Build or change a Nuxeo Satori business app, an app definition of version 2, or a package's configuration, in this configuration repository, against the development server. Read the server's model, page providers, workflows, vocabularies and operations through the nuxeo-satori MCP server, make every write to a package in config-packages/ through its write tools, which run the app generators and keep a change only when the package then passes satori validate's steps, then check it with the model and hand installing and releasing to a person. Use when asked for an app, a record page, a queue or an action, or to change a package under config-packages/.
---

# Build a business app with the agent

You write configuration, in this repository, for the customer's own Nuxeo Satori. A developer asks
for an app in plain words; you write the package, the tools check every write, and a person
installs and releases it. You write configuration only. You never write the data model of the
server, or code: the types, schemas, page providers and lifecycles come from Nuxeo Studio or a
model package, and are on the server already.

Everything you need is in this repository: `@nuxeo/satori-cli`, installed by `npm ci` and pinned
in `package.json`, carries the checks, the JSON Schemas, the generators, the MCP server and the
reference. You need no other repository, and no source of Nuxeo Satori's.

**Read the reference first:** `read_reference` with `{ "path": "knowledge/README.md" }`, or
`node_modules/@nuxeo/satori-cli/knowledge/README.md`. It holds every file a package has and which
tool writes it, a recipe for each kind of request, a worked example of a claims app, branding and
the colour tokens, every id the platform registers, and read-only example apps. It is this
version's, as the checks are.

**The customer's configuration is one package,** the one `satori create` wrote in
`config-packages/`: their branding, what the app shows, and their app definition, together. Add
to it; do not make another package unless the person asks for one.

## What exists, and what does not

| Step                  | How                                                                                        | State                                                                |
| --------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 1. Read the server    | The MCP server `nuxeo-satori`, `satori mcp`                                                | Built: 12 read-only tools, the reference among them                  |
| 2. Write the files    | `apply_generator`, `write_package_file`, `remove_package_file` and `apply_package_changes` | Built: each keeps only what passes `satori validate`'s steps         |
| 3. Check them         | Each write checks first; `satori validate` with the model as well                          | Built. The write tools take no model                                 |
| 4. See it on a server | A person installs the built zip on the development server                                  | **`preview_package` does not run here**: it refuses, serving nothing |
| 5. Release it         | `release_check` says it is ready and the tag; a person tags it; the workflow builds it     | Signing once `trusted-signers.json` is configured. No promotion      |

Say this to the person at the start, and again when you reach steps 4 and 5. Do not describe a
step as done that this table says is not built.

## 0. Before you start

- **Node 24 and `npm ci`** in this repository. The MCP server is the tool's: `.mcp.json` and
  `.cursor/mcp.json` start it from `node_modules/.bin`, as `satori agents sync` wrote them.
- **A development server whose model you may share with the model you run on.** Everything the
  tools answer goes to you. Never point them at production, or at a server holding data you may
  not share.
- **Credentials never pass through you:** `NUXEO_URL`, `NUXEO_USER` and `NUXEO_PASS` reach the
  server from its environment: exported before a terminal IDE starts it, or, in the Claude app,
  from `.claude/settings.local.json`, which the person writes with
  `./node_modules/.bin/satori connect` in a terminal (the app's terminal pane). There is no default
  account. Never run `connect`, never read or edit `.claude/settings.local.json`, never write a
  credential into a file, a command's arguments, an address or a message, and never ask for the
  password in the chat.
- **When the server cannot be read,** every server read refuses at once, naming what is missing.
  Tell the person, and ask them to export the three and restart the server, or to go on without:
  `validate_package` and the write tools need no credential.

## 1. Read the server

Find out what is there before writing anything. Every name a package writes must exist on the
server or be registered in the platform; a guess is refused, or worse, passes and shows nothing.

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
| how to do what the person asks, and the examples  | `read_reference`, `{ "path"? }`                    |

- **The type the person names must exist.** If it does not, say which types are there: creating
  one is Studio's. Only for a demo or a prototype, and only on the person's yes, offer a stand-in
  model (step 2, `app-model`).
- **A page provider's `?` parameters are filled in order.** A queue has no open record, so a page
  provider that needs a parameter takes a literal.
- **An indexed page provider lags a write** (`list_page_providers` marks them): a record created a
  second ago may not be listed yet.
- **An operation the server has is not one a package may name.** The deployment's allow-list,
  `deployment/build-allow-list.json` in the package, says which; with none, every operation is
  refused. A person writes it, never you.

The generators and the checks take the model as a file, read inside this repository only. Write it
into `tmp/`, which git ignores, and never commit it: it is the customer's model.

```bash
./node_modules/.bin/satori model pull --server "$NUXEO_URL/nuxeo" --out tmp/content-model.json
```

## 2. Write the files, through the write tools only

**Every write to a package goes through the MCP server's write tools.** Never write a package file
with your own file tools or a shell command: those write whatever they are given, and the write
tools keep only what passes.

| To write                                              | Call                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| one file of the app definition, whole                 | `write_package_file`, `{ "package", "path", "content" }`                        |
| one file of the app definition taken out              | `remove_package_file`, `{ "package", "path" }`, then `app-registry` for you     |
| what a generator writes                               | `apply_generator`, `{ "package", "generator", "options" }`                      |
| several steps that would each be refused on their own | `apply_package_changes`, `{ "package", "changes": [...] }`, all written or none |

A package is one folder directly inside `config-packages/`, named in kebab case, and `package` is
its path from here, such as `config-packages/acme-claims`. A change of `apply_package_changes` is
`{ "kind": "write", "path", "content" }`, `{ "kind": "remove", "path" }` or
`{ "kind": "generator", "generator", "options" }`. **To give a file another name,** remove the old
one, write the new one and every file that named the old, then `app-registry`, in one call.

Each write makes the change to a staging copy, runs `satori validate`'s steps on it, its names
compared with the other packages in `config-packages/`, and writes to the package only when there
is no finding. Read the answer every time:

- **`written: true`:** the package now holds `changes`, and passes. Read its `warnings`, when
  there are any, and fix what they name.
- **`written: false`:** nothing was written. `validation.findings` and `validation.refusedAt` say
  why. Fix what they name and write again. An id the platform or the package does not register (a
  widget, a rule, an operation the allow-list does not name) is refused at write time: never
  rename it to something else unregistered, and never invent one. Tell the person what is not
  there.
- **An error:** the request was refused before anything ran, and the message says why: a path
  that leaves the package, a link, a file these tools do not write, an option a generator does not
  take. Do not work around it with your own file tools.

`write_package_file` writes `app.json`, `home.json`, `navigation.json`, `actions.json`,
`queues/<id>.json`, `labels/<language>.json`, `tasks/<workflow>.<step>.layout.json` and
`layouts/<Type>/<mode>.layout.json`, under `bundle/agentic-ui-config/`, each a JSON object of
`"version": 2`; and the package's two layers there, `bootstrap.json` (branding, themes, colours)
and `manifest.json` (what the app shows), when its component names them, as `satori create`'s
does. Their checks hold a theme to what the application shows: `knowledge/branding.md` and
`knowledge/theme-tokens.md` say how to write one. The generators write the rest: `package.xml`, the manifest, the component, the
kit's connectors. The options are those of each generator's schema, by name; the tool gives
`package` from its `package` argument. `modelServer` is refused: a generator would send the
credentials to the address it is given. Give `model` instead, the file of step 1.

**The app goes in the customer's package.** One with no `bundle/agentic-ui-config/app.json` has no
app yet: ask the person its name and its groups, then add it in one call, its `packageVersion`
the one `package/package.xml` has:

```jsonc
// apply_package_changes: the app, its labels, and app-registry, which names it in the component
{ "package": "config-packages/acme-config", "changes": [
    { "kind": "write", "path": "bundle/agentic-ui-config/app.json",
      "content": "{ \"version\": 2, \"id\": \"acme-claims\", \"label\": \"Acme Claims\", \"packageVersion\": \"1.0.0\", \"platform\": \">=0.2.0 <1.0.0\", \"address\": \"acme-claims\", \"groups\": [\"claims-handlers\"] }" },
    { "kind": "write", "path": "bundle/agentic-ui-config/labels/en.json",
      "content": "{ \"version\": 2, \"labels\": {} }" },
    { "kind": "generator", "generator": "app-registry" } ] }

// apply_generator: a record page
{ "package": "config-packages/acme-config", "generator": "app-layout",
  "options": { "type": "Claim", "model": "tmp/content-model.json" } }

// apply_generator: another record page, and the Edit form with the fields it must have
{ "package": "config-packages/acme-config", "generator": "app-layout",
  "options": { "type": "Policy", "model": "tmp/content-model.json" } }
{ "package": "config-packages/acme-config", "generator": "app-form",
  "options": { "type": "Claim", "mode": "edit", "required": "dc:title,claim:number",
               "model": "tmp/content-model.json" } }

// apply_generator: a queue, on a page provider describe_page_provider showed
{ "package": "config-packages/acme-config", "generator": "app-queue",
  "options": { "id": "open-claims", "pageProvider": "acme_open_claims",
               "columns": "claim:number,dc:title,claim:status", "sort": "claim:number" } }

// apply_generator: a lifecycle button, on the record page and the queue's rows
{ "package": "config-packages/acme-config", "generator": "app-action",
  "options": { "id": "acme-claims.approve", "transition": "approve", "on": "record,row",
               "type": "Claim", "confirm": "Approve this claim?", "queue": "open-claims" } }

// apply_package_changes: the home written by hand, and the app-registry that names it
{ "package": "config-packages/acme-config", "changes": [
    { "kind": "write", "path": "bundle/agentic-ui-config/home.json", "content": "{ ... }" },
    { "kind": "generator", "generator": "app-registry" } ] }
```

What each writes, and what it leaves to you:

- **`app-package`:** a package of its own, with its app: only when the person asks for a second
  package. An address that is a platform route (`search`, `tasks` and the others) is refused.
- **`app-layout`:** one card per schema of the type, leaving out Nuxeo's own unless `schemas`
  names them, a widget only where the model says more than the type. Its "Left out" names what it
  did not write, and why.
- **`app-form`:** the Edit or Create form, `"required": true` on the fields `required` names.
- **`app-queue`:** the page provider, columns, sort and page size. Facets are the next edit, with
  `write_package_file`: `"facets": [{ "aggregate": "<id>", "labelKey": "<key>" }]`, each an
  aggregate the page provider defines.
- **`app-action`:** a transition or an operation (`operation`, with `parameters` as JSON), on
  `record`, `row` or `bulk`, and `queue` to offer it there. An id starting `app.` or `core.` is the
  platform's, and refused.
- **`app-registry`:** the component's `<app>`, naming every file of the app definition the
  registry serves. Run it in the same call as writing such a file by hand.
- **`app-connector`:** a connector of the package's own, for a card of another system's fields.
  It writes no address and no credential: each is a server setting a person sets.
- **`app-dependency`:** a package this one depends on, in `package.xml`.
- **`app-model`** writes a stand-in type, its schema and page providers, for a demo or a
  prototype only. It is refused on a package with no `content-model.json`: the types of a
  customer's server are Studio's. On the person's yes, for a development server, make the package a
  stand-in model's with `./node_modules/.bin/satori model pull --server "$NUXEO_URL/nuxeo" --out config-packages/<package>/content-model.json`,
  which they approve when asked, then call `app-model` once a type. Never write a type the server
  has. `knowledge/recipes.md`, "A stand-in model", and `knowledge/payers.md` show it.

Then edit what the generators wrote, with `write_package_file`, as the person asks. Write the whole
file each time, starting from what the package holds now:

- **Fields come in the order the server lists them,** not the schema's. Reorder them.
- **Pick the widgets a person would:** `currency` with its code, `status-badge` with its tones,
  `phone`, `email`, `relative-date`. A widget must show its property's type; the check refuses one
  that does not, given the model.
- **Rules, computations and related records** are registered ids only: no expression and no code.
  A field rule in plain words becomes `visibleWhen`, `required` or `readOnlyWhen` with a registered
  rule. If no rule says it, tell the person; do not invent one.
- **Every `labelKey` needs a text,** in the package's `labels/en.json` or the platform's
  catalogue. Write the text in the same call as the key: `apply_package_changes`, the labels first.
- **Sensitive fields.** Ask before showing an identifier such as a social security number. Hiding a
  field with a rule is a convenience, not a control: the server still returns it to anyone who may
  read the record.

The names a file may use, its widgets, rules, slots and actions, are the ones the platform
registers. This version of the tool lists them in
`node_modules/@nuxeo/satori-cli/platform/platform.json`, under `surface`, as `widget <name>` and
`id <name>`; the extension reference explains each:
<https://github.com/nuxeo/Nuxeo-Satori-UI/blob/main/docs/extension-reference.md>. Each
file's JSON Schema is in `node_modules/@nuxeo/satori-cli/schemas/`. A file a generator writes names
its schema by the path Nuxeo Satori keeps it at, which this repository does not have; nothing reads
`$schema`, so leave it.

## 3. Check them: every write already did

Each write ran `satori validate`'s steps on the package as it would be, the package's own
allow-list given when it has one, and nothing else. Two checks are still yours, before you say
anything works:

```bash
./node_modules/.bin/satori validate config-packages/acme-claims --kits config-packages --model tmp/content-model.json
```

- **Give it the server's model.** The write tools give none, so a field the type does not have and
  a widget that does not fit its property both pass them. With `--model`, the command refuses them.
- **`validate_package` checks a package as it is,** such as one a person changed by hand.
- **Read the findings, then fix the file.** Each names the file, the place and the reason. Never
  weaken a check, rename an id to something unregistered, write the file some other way, or leave
  out the model to get a pass.
- **What is not checked:** that a page provider of the server's exists, its columns and sorts, and
  its NXQL. Check those by reading the server, and run a query read-only on the development server,
  as a search, before relying on it.

## 4. Seeing it on a server: a person's step

`preview_package` does not run from this repository: it refuses, and serves nothing. To see the
package, a person installs its zip on the development server:

```bash
./node_modules/.bin/satori build config-packages/acme-claims --out dist --kits config-packages
```

Installing a package into a server is the person's decision: never do it yourself. The records the
pages show must be on the server, with the types the package names.

## 5. Releasing it: a person's step

1. The person raises the version in `package/package.xml`, `app.json`'s `packageVersion` and the
   manifest's `Bundle-Version`, together, as far as the changes need: a removed queue, layout or
   label key needs a major. The write tools do not raise a version.
2. **Check it is ready with `release_check`,** `{ "package": "config-packages/acme-config",
"previous": "<the zip installed now>" }`, or `./node_modules/.bin/satori release-check
config-packages/acme-claims --previous <zip>`. It builds and validates the package, holds it to
   the version installed when `previous` is given, and checks that its tag,
   `app-package/<name>/<version>`, is not one git has. `ready: false` says why; `ready: true` gives
   the two commands a person runs. It never tags or pushes.
3. The pull request merges, once its workflow, `.github/workflows/satori.yml`, passes.
4. The person runs the two commands `release_check` gave, on the merged commit: the tag and its
   push. The workflow builds it again, and, once `trusted-signers.json` at the root names the
   workflow, signs it keyless and verifies it. Nothing promotes it to a server.

**Never run the tag or push commands yourself, never sign a package, and never present one as
released:** give the person the commands, and say what is left for them.

## After every change: check and build, then say what is the person's

1. Run `npm run validate` and `npm run build` yourself, and report what they print: the zip's
   name and its sha256, or the step that refused it and why.
2. Before a change is installed over an earlier one, raise the version:
   `./node_modules/.bin/satori version config-packages/<package> patch`, which changes
   `package.xml`, the manifest and `app.json` together.
3. Say what is left for the person: committing and pushing; installing the zip on the development
   server, which restarts it; creating the app's groups there, with people in them; releasing.

## Done means

- every write to the package went through `write_package_file`, `remove_package_file`,
  `apply_generator` or `apply_package_changes`, and the last answered `written: true`;
- `satori validate` passes with the server's model, and with the allow-list when there is an
  operation;
- every id the package names is registered, or is the package's own;
- the reply lists what is not shown yet and what is left for a person: installing, releasing.

## What this skill does not do

- Write document types, schemas, page providers or lifecycles: Studio's.
- Write Angular or any other code: a package is configuration only.
- Write a package any way but the write tools, or write its `deployment/` allow-list, its assets
  or its code.
- Edit the files `satori agents sync` writes: this skill, `AGENTS.md`'s satori section, or the
  `nuxeo-satori` server in `.mcp.json`. The tool replaces them.
- Install a package or a connector, set an address or a credential on a server, tag, push a tag,
  or sign: each is a person's.
- Run `satori connect`, or read or edit `.claude/settings.local.json`: the credentials are the
  person's, and the settings deny you the file.
