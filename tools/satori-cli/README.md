# @nuxeo/satori-cli

The one builder of a customer's Nuxeo Satori configuration: decision K's first step, as section 5
of `docs/business-apps/extension-model.md` proposes it (pull request #786). A customer keeps all
of their configuration in one repository of their own, and checks and builds it with this tool,
outside this repository, with Node alone.

**Not published.** The package is `"private": true` at 0.1.0. Publishing it waits for decision K's
owners ([decisions.md](../../docs/business-apps/decisions.md)), so nothing here can be installed
from a registry yet: it is built from this repository and run from the folder it is built into, or
from a tarball `npm pack` makes of that folder.

## The commands

```bash
satori validate <package> [options]
satori build <package> [--out <directory>] [options]
satori upgrade-check <package> --previous <directory or zip> [--deployment <file>] [--json]
satori model pull --server <address> --out <file>
satori create <directory> --name <name> --owner <prefix> [--title <text>] [--vendor <text>]
```

- **`validate`** takes every step `build` takes and writes nothing: the zip is built and verified
  in a scratch folder, which is then removed.
- **`build`** writes the package's Marketplace zip and its `.sha256` into `--out`, the package's
  `dist/` by default, and with `--previous` its changelog.
- **`upgrade-check`** holds the package to the package it was, a folder or the zip it was built
  into: what a customer may override or name in it is removed only with a migration note, and its
  version rises as far as that needs ([package-pipeline.md](../../docs/business-apps/package-pipeline.md),
  section 10).
- **`model pull`** writes a server's content model to a file, for `--model`. It only reads,
  `GET`s of `/api/v1/config/`, as `NUXEO_USER` with `NUXEO_PASS`, from the environment.
- **`create`** writes a configuration repository, below.

The options of `validate` and `build` are the pipeline's, `scripts/app-package.mjs`'s:
`--allow-list`, `--registered`, `--platform`, `--model` or `--model-server`, `--previous`, `--kits`
and `--tag`. `satori --help` says what each does.

## One builder

`satori build` and `scripts/app-package.mjs` run one implementation,
[`scripts/package-pipeline/`](../../scripts/package-pipeline/pipeline.mjs), with the same six steps,
and write the same zip. A package may hold any mix of:

| What                                                                                                          | Checked by                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Layer 0, `bootstrap.json`, and Layer 1, `manifest.json`                                                       | Step 2: every key is one the application reads, held to the platform's schemas. Step 4: the configuration builder's checks        |
| Assets and version 1 layouts                                                                                  | Step 4: the configuration builder's checks, `build.mjs`'s, the server's own                                                       |
| An app definition: `app.json`, `home.json`, `navigation.json`, layouts, queues, `actions.json`, tasks, labels | Step 2: the validator, then the pipeline's checks of page providers, connectors, contributions and the other packages' names      |
| The package                                                                                                   | Step 1: no symbolic link. Step 3: no name Satori uses, and an app definition's one version. Step 5: the zip. Step 6: its checksum |

What differs, each on purpose:

- **The builder is the tool's own.** Step 4 runs the `config-package` generator's `build.mjs` that
  the tool carries, byte for byte, on the package. A package needs no `build.mjs` of its own, and
  one that is there is never run: one that is not the tool's is said in a note.
  `app-package.mjs` runs the package's own, and refuses one that is not the generator's.
- **A package with no `app.json` is configuration alone,** and is held to the configuration
  builder's checks and the configuration's own. `app-package.mjs` refuses it, being the app
  package pipeline. A package with any file of an app definition and no `app.json` is refused.
- **The platform is the one the tool carries:** `--platform` is its version when it is not given,
  and the upgrade check's platform as it is is the one it was built from. `--previous-platform`,
  which reads the platform's sources at another version, stays with `app-package.mjs`.
- **No kits are compared unless `--kits` names their folder.** `app-package.mjs` compares a kit
  in `business-apps/packages/` with the others there.
- **`--previous` may be a zip,** which the tool unpacks into the package it was built from.

## The content model

`--model <file>`, or `--model-server <address>` with `NUXEO_USER` and `NUXEO_PASS` in the
environment, holds layouts, queues and page providers to a server's types, facets and schemas. The
credentials go in an `Authorization` header and nowhere else: an address carrying them is refused.
With neither, a package that ships a stand-in model of its own is held to its own
`content-model.json`, and any other package to no model, which the run says.

## A customer's repository

```bash
satori create acme-satori --name acme-config --owner acme
```

```text
acme-satori/
  package.json                   @nuxeo/satori-cli as a dev dependency, pinned
  AGENTS.md                      the commands and the rules, for any AI IDE's agent
  .gitignore
  .github/workflows/satori.yml   satori validate and satori build on every pull request
  config-packages/acme-config/   a first package that builds: Layer 0, Layer 1, its component
```

The package is the `config-package` generator's: `create` runs the generator's own scaffolder,
which the tool carries, so the names it refuses, Satori's own (`defaults`, `nuxeo-agentic-ui`) and
those Windows reserves, are the generator's. Nothing is written over: the directory must be new or
empty. **Not written yet, and a later slice:** `agents sync`, the app builder skill it installs,
`.mcp.json` and the MCP server; signing and promotion in the workflow, which wait for decision M.

## Building it, and running it outside this repository

```bash
node tools/satori-cli/build.mjs           # or nx run @nuxeo/satori-cli:build: into dist/tools/satori-cli/
node dist/tools/satori-cli/satori.mjs --help
```

The build bundles the command and the validator into plain JavaScript with esbuild, which the
lockfile already pins, and copies what the tool carries: the builder, the generator's scaffolder and
templates, the schemas, the platform's English catalogue, and `platform.json`, what the upgrade check
reads of the platform. It refuses to build when the server's validator,
`nuxeo-agentic-core`'s `agentic-ui-validator/validator.js`, is not what the app definition's
library builds now, so the tool's validator and the server's are always the same source's. The
folder is what `npm pack` packs; Node 24 and the system's `unzip` run it.

## Its controls

`node tools/satori-cli/selftest.mjs`, the project's `test` target, builds the tool, then:

- builds every kit in `business-apps/packages/` through `app-package.mjs` and through the tool, and
  requires the same SHA-256, and the same report from the validator through `bin.mjs` and through
  the tool's `validator.mjs`; a tool whose builder differs by one byte must build another digest;
- packs it with `npm pack`, unpacks it into a folder with no `node_modules`, and builds a copy of a
  kit there, to the same digest, and a repository `create` writes, under Node's permission model,
  so that no Node process of the run can read anything outside that folder: reading this
  repository's `package.json` from it must fail;
- refuses, each at its own step: a layout's unregistered widget, a Layer 1 key, a Layer 0 key and a
  preset's the application does not read, a property the model does not have, a name Satori uses in
  `create`, in a package and in a fragment, a home with no `app.json`, a key the builder refuses, a
  symbolic link, and the command's own errors; and passes a scaffold, a package mixing every layer,
  a package with an older `build.mjs`, the upgrade check against a folder and a zip, and
  `model pull` against a stand-in server, which must get the credentials in a header only;
- holds the names Satori uses to the generator's, in both its copies.
