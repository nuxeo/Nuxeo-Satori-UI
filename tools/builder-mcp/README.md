# The Builder MCP server

Phase 3 of the [development plan](../../docs/business-apps/development-plan.md): the MCP server of
the Builder kit. An agent building an app definition package uses it to read a Nuxeo server's
content model, page providers, workflows, vocabularies and Automation operations, and to run the
package pipeline's checks on what it wrote.

It runs beside the developer's tools, against a development server, and never in production
([architecture.md](../../docs/business-apps/architecture.md), section 8).

## Not here yet

The plan gives the server four jobs. Three are here:

- **Here:** reading the server, validating a package, and previewing it in dev mode on the local
  development server.
- **Not here:** publishing it to pre-production. It waits for signatures and promotion after a
  person approves, which [package-pipeline.md](../../docs/business-apps/package-pipeline.md),
  section 9, proposes and nobody has decided. Until then a package is published by a tag, in CI,
  as that document says, and its version is held to what changed (section 8).

## The tools

| Tool                     | What it answers                                                                                                                                             | Nuxeo reads                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `get_content_model`      | Every document type (parent, facets, schemas), facet (schemas) and schema (prefix, field count)                                                             | `/config/types`, `/config/facets`, `/config/schemas`                               |
| `describe_document_type` | One type's fields, as `<prefix>:<name>` with their types, by schema; the facets that bring a schema; ancestors and subtypes                                 | the same three                                                                     |
| `describe_schema`        | One schema's fields, by name or prefix, and the types and facets that use it                                                                                | the same three                                                                     |
| `list_page_providers`    | The names of the server's page providers, and which the search index answers                                                                                | `/management/page-providers`                                                       |
| `describe_page_provider` | One page provider: its pattern or fixed part, how many parameters it takes in order, its predicates, sorts, page sizes, aggregates and quick filters        | `/search/pp/<name>`                                                                |
| `list_workflows`         | The workflow models and their variables' names                                                                                                              | `/workflowModel`                                                                   |
| `describe_workflow`      | One model's variables, and each step's task, buttons, variables and transitions; a task step's task form file and `var:` fields                             | `/workflowModel/<name>`, its graph, the model and step documents, `/config/facets` |
| `list_vocabularies`      | The vocabularies; other directories are counted, not named                                                                                                  | `/directory`                                                                       |
| `get_vocabulary`         | One vocabulary's entries, a page at a time                                                                                                                  | `/directory`, `/directory/<name>`                                                  |
| `list_operations`        | Operations and chains, filtered by category or text, with every category's count                                                                            | `/automation`                                                                      |
| `describe_operation`     | One operation or chain, by id or alias: signature and parameters                                                                                            | `/automation`                                                                      |
| `validate_package`       | Whether a package folder passes the package pipeline, its findings with file and place, and the step that refused it                                        | none                                                                               |
| `preview_package`        | A package validated, then served to the local dev server: the address to open, each page, what could not be served and why, and what the dev server answers | none                                                                               |

Some things about them are worth knowing before relying on them:

- **Prefixes are the ones an app definition writes.** Nuxeo reports `file`, `uid` and `files` with
  an empty prefix and addresses them by name, as `file:content`
  ([AGENTS/11-beta-program.md](../../AGENTS/11-beta-program.md), section 3). So does every tool here.
- **The content model takes three reads.** `/config/types` alone covers only the schemas a type
  reaches, so the schemas come from `/config/schemas` and what a facet brings from
  `/config/facets`.
- **The page provider list needs an administrator.** It comes from Nuxeo's management API.
  `describe_page_provider` reads one definition by name without it.
- **A page provider's parameters are its `?`.** A queue's or a related-records card's
  `parameters` fill them in order. Nuxeo builds the query from the where clause's fixed part when
  the page provider has a where clause, and from its pattern otherwise, so only that one is
  described and counted; a `?` inside quotes is not one. `:name` parameters are listed by name. A
  where clause's predicates are filled from a search document instead, and are listed with the
  property each one filters.
- **An indexed page provider lags.** One the search index answers does not show a write at once
  (AGENTS/11-beta-program.md, section 3), so `list_page_providers` marks them. `indexed` follows
  the search client the management API names: `opensearch` is the index, and `repository`, the
  other client Nuxeo 2025 registers, does not lag. With no client named, it is `null` for the
  search service's class, which could be either.
- **A workflow step is read by its path.** `@children` leaves steps out, as it leaves out every
  document hidden in navigation, so each step's document is read at `<model path>/<step id>`, with
  its `route_node` schema only. A step that cannot be read is reported with the reason, and its
  variables are left unknown.
- **Vocabularies are the directories `/directory` lists with a vocabulary schema.** Which
  directories it lists is Nuxeo's choice; the local one lists its vocabularies only. Any other is
  counted, not named, and its entries are refused.
- **A task form's file and fields** follow
  [app-definition-v2.md](../../docs/business-apps/app-definition-v2.md), section 6:
  `tasks/<workflow>.<step>.layout.json`, and `var:<name>` for each variable of the step and of
  its workflow.
- **An operation the server has is not one a package may name.** That is the deployment
  allow-list's to say (decision 3): on a server, the deployment's contribution to
  `org.nuxeo.agentic.ui.operations`, which a package may never make. `validate_package` refuses
  every operation unless it is given an allow-list, or the package names the one it is built
  against, `deployment/build-allow-list.json`, as CI gives the pipeline.
- **`validate_package` is the pipeline itself.** It runs `scripts/app-package.mjs` as a command,
  as `npm run app-package` and CI do. Given the folder alone it passes what the workflow passes,
  `--platform` with `libs/platform`'s version, and the package's build allow-list when it has one,
  and answers `asCi: true`. Another allow-list, a registered file or another platform version are
  the deployment's, change what is checked, and are listed under `departsFromCi`.
- **It reads inside the repository only.** The pipeline's messages can quote what it read, and
  they go to the agent, so:
  - the folder and the files must be in the repository, and the answer for a path outside is the
    same whether or not it exists;
  - no link is followed, in the path or anywhere in the package: one is refused, and so is a
    hard link, a file with a second name elsewhere;
  - nothing hidden, such as `.git`, `.env` or `.claude`, is read;
  - the allow-list and the registered file are JSON files.

  A package kept elsewhere has to be copied in first, without links. Inside the package, the
  pipeline then refuses, before reading it, a symbolic link anywhere in the package, and a
  component path in the bundle's manifest that leaves `bundle/` or names a folder or a hard link
  ([package-pipeline.md](../../docs/business-apps/package-pipeline.md), section 2). It does not
  refuse a hidden file, or a hard link other than a component, as this tool does for the paths it
  is given.

- **It writes nothing in the package.** The zip goes to a temporary folder, which is removed, and
  nothing is published. The pipeline gets only `PATH`, the temporary folder and the locale from the
  environment, so no credential reaches it. Past three minutes it is stopped, with every process
  it started, and so it is when the server exits or is stopped by a signal it can catch. On
  Windows only the pipeline's own process is stopped, and only on a timeout; a server killed
  outright cannot stop anything. Because it builds a zip, it is the one tool not marked read-only,
  so a client may ask before running it.

## Previewing a package

`preview_package` shows a package in the app running from this checkout, `npx nx serve nuxeo-ui`,
as dev mode would on a server:

1. **It validates first,** as `validate_package` does, with the same arguments. A package the
   pipeline refuses is not served, and the answer holds the findings.
2. **It serves through `config:dev`.** It runs `scripts/dev-config.mjs`, the script
   `npm run config:dev` runs, with Node, as npm would, giving it one option per file the dev server
   can serve: `--layout` for each `layouts/<Type>/<mode>.layout.json`, `--home`, `--navigation`,
   `--queue` for each queue, `--labels` for each language and `--task` for each task form. The
   script writes them into `apps/nuxeo-ui/public/agentic-ui-config/`, which git ignores, and
   **replaces what was served before**: one package is previewed at a time.
3. **It says what it could not serve,** and why: `app.json`, which the app registry serves on a
   server, not the development server; `actions.json` and `modules/`, which nothing in the app reads
   yet; `assets/`, which `config:dev` does not serve; version 1's fragments; and a file whose name
   the validator accepts and `config:dev` does not, such as labels for `es-419`, which would stop
   the script whole.
4. **It checks the dev server,** at `DEV_SERVER_URL`: each file the dev folder holds is asked for
   and compared byte for byte, and each the run removed is asked for again. Those not answered as
   they should be are named; the package is served all the same. The dev server sees a new file a
   moment after it is written (measured: under a second), so it is given five seconds. A dev server
   started before `agentic-ui-config/` existed serves nothing under it until it is restarted, and
   one started from another checkout or worktree serves that one's folder: the answer says which
   to do. Nothing answering means it is not running.
5. **It answers with the addresses:** the home, each queue and the tasks page, under
   `<DEV_SERVER_URL>/#/`. A record page opens on a record of its type, which the tool does not look
   up, since it reads no record: open one from a queue or a search.

The app still signs in to the Nuxeo server the dev server proxies to
(`apps/nuxeo-ui/proxy.conf.json`), and draws what that server holds: the types, page providers,
workflows and records the package names must be there.

**What it writes, and nothing else:** the dev folder, through the script; and, while it runs, a
folder of its own in the package's `dist/`, for the pipeline's zip and what step 5 unpacks to read
it back, removed afterwards, with `dist/` itself when the tool made it. The app definition's files,
`bundle/agentic-ui-config/`, are read before the pipeline runs and again after the script, and a
package whose definition changed in between is
refused, with the dev folder put back to the platform's defaults: what is served is what was
validated. No credential reaches the pipeline or the script.

**On a server, in dev mode.** A Nuxeo server with the Satori package can read a development
override folder on every request, `${nuxeo.data.dir}/agentic-ui-config-dev`, once
`nuxeo.agentic.ui.config.dev=true` is in its `nuxeo.conf`
([extension-reference.md](../../docs/extension-reference.md), "The fast loop while you are tuning
a value"). That folder takes only `bootstrap*.json`, `manifest*.json`,
`layouts/<Type>/<mode>.layout.json` and `assets/` (`DevOverrides.java`), and the configuration
servlet answers only those addresses. So on a server it previews a package's **layouts** and
nothing else: not the home, the menu, the queues, the labels or the task forms, which the app
registry serves only from an installed package that contributes its app. By hand, on the local Docker one, after setting the property and restarting once:

```bash
docker exec nuxeo mkdir -p /var/lib/nuxeo/agentic-ui-config-dev
docker cp business-apps/packages/<package>/bundle/agentic-ui-config/layouts \
  nuxeo:/var/lib/nuxeo/agentic-ui-config-dev/
```

The tool does not do this: writing to a server is a person's decision, and the property must never
be set on a shared or production server. Measured on 23 November 2026, the local Docker Nuxeo has
the Satori package and the Payers kit installed and the property unset.

## What it sends, and where

Hyland's AI use requirements apply to everything an agent reads. This server is built so that the
only place it sends anything is the Nuxeo server it is configured with:

- **One server, read only.** Every request is a `GET` under `<NUXEO_URL>/nuxeo/api/v1/`. There is
  no other method in the code, so no tool can write, run an operation or start a workflow. A
  redirect is never followed, and a URL that would leave the configured server is refused before
  it is sent.
- **Nothing else goes out.** No telemetry, no other host. `validate_package` runs Node and
  `unzip` on this machine, needs no network, and reads only inside the repository.
  `preview_package` does the same, then sends `GET`s for the files it served to the dev server,
  `DEV_SERVER_URL`, which must be on this machine, with no credential and no redirect followed.
- **Definitions, not records.** The tools read the model, searches, workflow models, vocabularies
  and operations. None reads a document's content, a group, an audit entry or a file. A workflow
  model's own documents are read for their steps, with the workflow's schemas only, and a
  directory's entries only when it is a vocabulary. The one user read is the configured account's own `/me`, to check who the requests
  run as; no tool answers it.
- **What the tools answer goes to the agent.** The MCP client passes it to the model the agent
  runs on. Point the server at a development server whose content model you may share with it.

## Configuration

From the environment only, read once when the server starts:

| Variable         | Meaning                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `NUXEO_URL`      | The server's origin, such as `http://localhost:8080`. Default: that. `http` only for this machine             |
| `NUXEO_USER`     | Required. No default                                                                                          |
| `NUXEO_PASS`     | Required. No default                                                                                          |
| `DEV_SERVER_URL` | The dev server `preview_package` serves to. Default: `http://localhost:4200`, `nx serve`'s. This machine only |

- **No default account.** `scripts/beta-harness/nuxeo-credentials.mjs` says why. Without the pair
  the server still starts, `validate_package` and `preview_package` still answer, and each Nuxeo
  tool says what is missing. `preview_package` needs no credential: the person signs in to the app.
- **Checked on every call.** Each tool call first asks Nuxeo who it runs as (`/me`), and reads
  nothing unless the answer is `NUXEO_USER`, so an account that stopped being accepted since the
  last call is found. A server with anonymous authentication, such as the
  local Docker one, answers a request whose credentials it did not accept `200` as `Anonymous`,
  and a model read as the guest looks complete and is not. The harness's identity guard,
  `scripts/beta-harness/identity-guard.mjs`, judges the answer.
- **The password goes in the `Authorization` header, and nowhere else.** No message includes it,
  and the processes `validate_package` starts do not get it.

## Registering it with Claude Code

From the repository's root, in a shell where `NUXEO_USER` and `NUXEO_PASS` are exported:

```bash
claude mcp add-json nuxeo-builder --scope local '{"type":"stdio","command":"node","args":["tools/builder-mcp/src/main.ts"],"env":{"NUXEO_URL":"${NUXEO_URL:-http://localhost:8080}","NUXEO_USER":"${NUXEO_USER}","NUXEO_PASS":"${NUXEO_PASS}"}}'
```

Then `claude mcp list` shows `nuxeo-builder`, and `/mcp` inside Claude Code shows its tools.

- **Node 24 runs it as it is.** It strips the types from the TypeScript; there is no build step and
  no `tsx`. The repository's `node_modules` must be installed, for the MCP SDK and `zod`.
- **Run it from the repository's root**, or give `args` an absolute path. `validate_package` reads
  package paths relative to the repository either way.
- **The single quotes matter.** They keep the shell from expanding `${NUXEO_PASS}`, so the
  configuration holds the name of the variable, not the password.

## Running and testing it

```bash
npx nx test @nuxeo-satori/builder-mcp
npx nx run @nuxeo-satori/builder-mcp:typecheck
```

- **The unit tests run against recorded answers** of the local Docker Nuxeo, in
  [`src/testing/recorded/`](src/testing/recorded/). `manifest.json` says when and from where they
  were recorded, and what was trimmed from the large answers. A read the recordings do not hold
  fails its test, naming the read.
- **The tests that run the pipeline need `unzip`**, as the pipeline does. On a Windows runner,
  which has none, vitest lists them as skipped. Anywhere else they run, and fail without it, so a
  CI image that lost it is not mistaken for a pass. Nothing here has been run on Windows.
- **`src/main.spec.ts`** starts the real entry point over stdio, as Claude Code does: with no
  credentials, with a server that answers as its guest, with one that stops accepting the account
  after the first call, and validating the demo package.
- **`src/preview-package.spec.ts`** runs the real pipeline and a byte copy of
  `scripts/dev-config.mjs` in a scratch checkout of its own, so the tests never write this
  checkout's dev folder, against a stand-in dev server: the files served and not, a refused
  package, a dev server that is down, behind or slow to see a file, a package changed while it was
  previewed, and no credential reaching the script.
- **The recorded run.** With a Nuxeo running, this runs every Nuxeo tool's reads against it and
  prints what each answered. Without `--check` it also rewrites the recordings, which are
  committed to a public repository, so:
  - **it keeps stock Nuxeo names only.** Every list the server answers is trimmed to the names in
    `KEPT` (`src/testing/recordings.ts`), each kept type to its stock facets and schemas, and a
    test holds the recordings to that list. What a kept name holds is kept as the server answered
    it: a server that overrides `default_search` or adds entries to `country` puts that in. So
    record from a stock server, such as the local Docker one;
  - **it keeps no document property but the workflow's own**, and writes none that would hold
    `NUXEO_USER` or `NUXEO_PASS`;
  - **it writes only from a server on this machine**, refusing before any request. That checks the
    host, not whose model the server holds: a forwarded port or a restored customer database
    passes it, which is what the first two are for.

  Read the diff before committing them all the same:

  ```bash
  node tools/builder-mcp/src/testing/record.ts --check
  ```

**Exit codes of the recorder:** 0, every scenario answered as expected; 1, one did not, or
nothing was written; 2, no credentials.
