# The Builder MCP server

Phase 3 of the [development plan](../../docs/business-apps/development-plan.md): the MCP server of
the Builder kit. An agent building an app definition package uses it to read a Nuxeo server's
content model, page providers, workflows, vocabularies and Automation operations, and to run the
package pipeline's checks on what it wrote.

It runs beside the developer's tools, against a development server, and never in production
([architecture.md](../../docs/business-apps/architecture.md), section 8).

## Not here yet

The plan gives the server four jobs. Two are here:

- **Here:** reading the server, and validating a package.
- **Not here:** previewing a package in dev mode, and publishing it to pre-production. Both are
  left for later on purpose. Publishing waits for the pipeline's versions, signatures and promotion
  after a person approves, which phase 3 also builds
  ([package-pipeline.md](../../docs/business-apps/package-pipeline.md), section 6). Until then a
  package is published by a tag, in CI, as that document says.

## The tools

| Tool                     | What it answers                                                                                                                                      | Nuxeo reads                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `get_content_model`      | Every document type (parent, facets, schemas), facet (schemas) and schema (prefix, field count)                                                      | `/config/types`, `/config/facets`, `/config/schemas`                               |
| `describe_document_type` | One type's fields, as `<prefix>:<name>` with their types, by schema; the facets that bring a schema; ancestors and subtypes                          | the same three                                                                     |
| `describe_schema`        | One schema's fields, by name or prefix, and the types and facets that use it                                                                         | the same three                                                                     |
| `list_page_providers`    | The names of the server's page providers, and which the search index answers                                                                         | `/management/page-providers`                                                       |
| `describe_page_provider` | One page provider: its pattern or fixed part, how many parameters it takes in order, its predicates, sorts, page sizes, aggregates and quick filters | `/search/pp/<name>`                                                                |
| `list_workflows`         | The workflow models and their variables' names                                                                                                       | `/workflowModel`                                                                   |
| `describe_workflow`      | One model's variables, and each step's task, buttons, variables and transitions; a task step's task form file and `var:` fields                      | `/workflowModel/<name>`, its graph, the model and step documents, `/config/facets` |
| `list_vocabularies`      | The vocabularies; with `all`, every directory by name                                                                                                | `/directory`                                                                       |
| `get_vocabulary`         | One vocabulary's entries, a page at a time                                                                                                           | `/directory`, `/directory/<name>`                                                  |
| `list_operations`        | Operations and chains, filtered by category or text, with every category's count                                                                     | `/automation`                                                                      |
| `describe_operation`     | One operation or chain, by id or alias: signature and parameters                                                                                     | `/automation`                                                                      |
| `validate_package`       | Whether a package folder passes the package pipeline, its findings with file and place, and the step that refused it                                 | none                                                                               |

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
  `parameters` fill them in order, in the pattern or in a where clause's fixed part; a `?` inside
  quotes is not one. A where clause's predicates are filled from a search document instead, and
  are listed with the property each one filters.
- **An indexed page provider lags.** One the search index answers does not show a write at once
  (AGENTS/11-beta-program.md, section 3), so `list_page_providers` marks them.
- **A workflow step is read by its path.** `@children` leaves steps out, as it leaves out every
  document hidden in navigation, so each step's document is read at `<model path>/<step id>`. A
  step that cannot be read is reported with the reason, and its variables are left unknown.
- **A task form's file and fields** follow
  [app-definition-v2.md](../../docs/business-apps/app-definition-v2.md), section 6:
  `tasks/<workflow>.<step>.layout.json`, and `var:<name>` for each variable of the step and of
  its workflow.
- **An operation the server has is not one a package may name.** That is the deployment
  allow-list's to say (decision 3). `validate_package` refuses every operation unless it is given
  one.
- **`validate_package` is the pipeline itself.** It runs `scripts/app-package.mjs` as a command,
  as `npm run app-package` and CI do, so it cannot drift from what CI refuses. The zip goes to a
  temporary folder, which is removed: nothing in the package is written, and nothing is published.
  `--platform` is `libs/platform`'s version unless another is given, as the workflow passes it.

## What it sends, and where

Hyland's AI use requirements apply to everything an agent reads. This server is built so that the
only place it sends anything is the Nuxeo server it is configured with:

- **One server, read only.** Every request is a `GET` under `<NUXEO_URL>/nuxeo/api/v1/`. There is
  no other method in the code, so no tool can write, run an operation or start a workflow. A
  redirect is never followed, and a URL that would leave the configured server is refused before
  it is sent.
- **Nothing else goes out.** No telemetry, no other host. `validate_package` runs Node and
  `unzip` on this machine, and needs no network.
- **Definitions, not records.** The tools read the model, searches, workflow models, vocabularies
  and operations. None reads a document's content, a user, a group, an audit entry or a file.
  A workflow model's own documents are read for their steps, and a directory's entries only when
  it is a vocabulary.
- **What the tools answer goes to the agent.** The MCP client passes it to the model the agent
  runs on. Point the server at a development server whose content model you may share with it.

## Configuration

From the environment only, read once when the server starts:

| Variable     | Meaning                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `NUXEO_URL`  | The server's origin, such as `http://localhost:8080`. Default: that. `http` only for this machine |
| `NUXEO_USER` | Required. No default                                                                              |
| `NUXEO_PASS` | Required. No default                                                                              |

- **No default account.** `scripts/beta-harness/nuxeo-credentials.mjs` says why. Without the pair
  the server still starts, `validate_package` still answers, and each Nuxeo tool says what is
  missing.
- **Checked before the first read.** The server asks Nuxeo who it runs as (`/me`) and reads
  nothing unless the answer is `NUXEO_USER`. A server with anonymous authentication, such as the
  local Docker one, answers a request whose credentials it did not accept `200` as `Anonymous`,
  and a model read as the guest looks complete and is not. The harness's identity guard,
  `scripts/beta-harness/identity-guard.mjs`, judges the answer.
- **The password goes in the `Authorization` header, and nowhere else.** No message includes it.

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
  [`src/testing/recorded/`](src/testing/recorded/). `manifest.json` says when they were recorded and
  what was trimmed from the large answers. A read the recordings do not hold fails its test, naming
  the read.
- **`src/main.spec.ts`** starts the real entry point over stdio, as Claude Code does: with no
  credentials, with a server that answers as its guest, and validating the demo package.
- **The recorded run.** With a Nuxeo running, this runs every Nuxeo tool's reads against it and
  prints what each answered. Without `--check` it also rewrites the recordings:

  ```bash
  node tools/builder-mcp/src/testing/record.ts --check
  ```

**Exit codes of the recorder:** 0, every scenario answered as expected; 1, one did not; 2, no
credentials.
