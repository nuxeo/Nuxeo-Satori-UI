# @nuxeo/satori-cli

The one builder of a customer's Nuxeo Satori configuration, and what lets their own AI IDE build
with it: decision K's tools ([extension-model.md](../../docs/business-apps/extension-model.md),
section 5). A customer keeps all of their configuration in one repository of their own, and checks,
builds and signs it with this tool, and builds it with an agent through its MCP server, outside this
repository, with Node alone.

**Not published.** The package is `"private": true` at 0.2.0. Publishing it waits for decision K's
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
satori agents sync [<directory>] [--check]
satori mcp [--root <directory>]
satori sign <zip> (--key <file> | --ephemeral-key --signers-out <file>) [--commit <sha>] [--out <file>]
satori sign <zip> --keyless --trusted-signers <file> --predicate-out <file>
satori verify <zip> --trusted-signers <file> [--signature <file>] [--name <package>] [--version <version>] [--trusted-root <file>]
satori release-check <package> [--previous <directory or zip>] [--json] [options]
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
- **`agents sync`** installs or refreshes the app builder skill, `AGENTS.md`'s section and the MCP
  server's entry, for any AI IDE ([The agent files](#the-agent-files-agents-sync)).
- **`mcp`** is the Builder MCP server, over stdio, in a configuration repository
  ([The MCP server](#the-mcp-server-satori-mcp)).
- **`sign`** and **`verify`** sign a zip and verify one, decision M's mechanism
  ([Signing](#signing-and-verifying-sign-and-verify)).
- **`release-check`** says whether a package is ready for a person to release, and the tag they
  push to release it ([Releasing](#releasing-release-check)). It never tags.

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
  package pipeline. A package with no `app.json` that holds anything of an app definition is
  refused, since nothing would check it: a file of the registry's that no fragment names as its
  body, a layout of version 2, or an `<app>`.
- **The platform is the one the tool carries:** `--platform` is its version when it is not given,
  and the upgrade check's platform as it is is the one it was built from. `--previous-platform`,
  which reads the platform's sources at another version, stays with `app-package.mjs`.
- **No kits are compared unless `--kits` names their folder.** `app-package.mjs` compares a kit
  in `business-apps/packages/` with the others there. The names compared are an app definition's,
  so a package that is configuration alone is compared with nothing, which a note says.
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
  AGENTS.md                      the repository's own part, then the tool's section
  .cursor/skills/  .claude/skills/  .agent/skills/
                                 satori-app-builder, the app builder skill
  .mcp.json  .cursor/mcp.json    the MCP server, satori mcp, with nothing secret in it
  .gitignore                     node_modules/, dist/, and tmp/ for a server's content model
  .github/workflows/satori.yml   check the agent files, validate and build every package; and for
                                 a tag, sign keyless once trusted-signers.json names the workflow
  config-packages/acme-config/   a first package that builds: Layer 0, Layer 1, its component
```

The package is the `config-package` generator's: `create` runs the generator's own scaffolder,
which the tool carries, so the names it refuses, Satori's own (`defaults`, `nuxeo-agentic-ui`) and
those Windows reserves, are the generator's. The agent files are `agents sync`'s, run on the new
repository, so `create` and a later `sync` write the same bytes. Nothing is written over: the
directory must be new or empty.

**The workflow** checks on every pull request and every push to `main`: `satori agents sync
--check`, so a version of the tool whose agent files were not synced is seen, then `validate` and
`build` of every package. On a tag `app-package/<name>/<version>`, its `sign` job, the one job with
an identity, signs that zip keyless and verifies it, once **`trusted-signers.json`** at the
repository's root names the workflow:

```json
{
  "signers": [
    {
      "id": "acme-ci",
      "kind": "github-workflow",
      "repository": "acme/acme-satori",
      "workflow": ".github/workflows/satori.yml"
    }
  ]
}
```

With no such file the job says signing is not configured, and signs nothing. Nothing in it
publishes or promotes a package.

## The agent files: `agents sync`

```bash
satori agents sync            # in the repository, or: satori agents sync <directory>
satori agents sync --check    # writes nothing; exit 1 names what differs
```

| File                                                                            | What is the tool's                                                          |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `.cursor/`, `.claude/` and `.agent/`, each `skills/satori-app-builder/SKILL.md` | the whole file                                                              |
| `AGENTS.md`                                                                     | the section from `<!-- BEGIN satori agents` to `<!-- END satori agents -->` |
| `.mcp.json`, Claude Code's, and `.cursor/mcp.json`, Cursor's                    | the server `nuxeo-satori`                                                   |

- **Versioned with the tool.** Each file is what this version writes, and a line in the skill and
  the section's first marker say which version. Run again, it writes nothing and touches no file.
  After an upgrade it refreshes them, and `--check`, which the workflow runs, fails until it has.
- **The customer's own edits are kept:** everything in `AGENTS.md` outside the section, to the
  byte, and every other server and key of an MCP file. An edit inside the section, or to the
  `nuxeo-satori` entry, is put back. An MCP file whose entry is this version's is in step however
  it is laid out, and is not written; one written again is laid out as JSON with two spaces, and
  one JSON would not give back as it is, with a key twice or a number it rounds, is refused.
- **Nothing secret is written.** The server's entry starts `node_modules/.bin/satori mcp`, the copy
  the repository's lockfile installs, never one `npx` would fetch, and names `NUXEO_URL`,
  `NUXEO_USER` and `NUXEO_PASS` as references, `${NUXEO_PASS:-}` for Claude Code and
  `${env:NUXEO_PASS}` for Cursor, which the client fills from its environment when it starts the
  server. Nothing of the environment is read when the files are written.
- **Refused, with nothing written:** an `AGENTS.md` with a marker missing, repeated or out of order,
  an MCP file that is not a JSON object, and a path through a link, so that nothing is written
  outside the repository.
- **The skill** is the customer edition of this repository's `app-builder` skill,
  [`.cursor/skills/app-builder/customer-edition.md`](../../.cursor/skills/app-builder/customer-edition.md),
  kept beside the edition this repository's agents read and mirrored with it by
  `npm run mirror:agents`. It sends the agent to the MCP server for every read and write, and to
  nothing of Nuxeo Satori UI's source.

## The MCP server: `satori mcp`

```bash
satori mcp                    # started by the IDE, in the repository, from .mcp.json
satori mcp --root <directory> # in another folder, as .cursor/mcp.json starts it
```

The Builder MCP server, [`tools/builder-mcp`](../builder-mcp/README.md), bundled into this tool, with
the same tools, by name, title, annotations and arguments; what their descriptions name is the
configuration repository's, `config-packages/` and `satori build`, not this repository's. It is a subcommand rather than a package of its
own, `@nuxeo/satori-mcp`, so that a write the server keeps is one `satori validate` keeps: its
`validate_package` and write tools run this tool's `satori build`, the same steps from the same
modules, at the same version, and the two cannot be installed apart. What differs from the server
in this repository is in its README's
["Outside this repository"](../builder-mcp/README.md#outside-this-repository-satori-mcp).

## Signing and verifying: `sign` and `verify`

Decision M's mechanism ([extension-model.md](../../docs/business-apps/extension-model.md),
section 7). Who may sign a customer's package is M's question, and stays open: the tool trusts no
one by default, and `verify` and `--keyless` are given the trusted-signers file the customer keeps.
The command is `scripts/package-pipeline/signature-command.mjs`, which
`scripts/app-package-signature.mjs` runs too, given the customer's repository, so what is signed
and what is refused are the same ([package-pipeline.md](../../docs/business-apps/package-pipeline.md),
section 9):

- **`sign --key <file>`,** a key the customer holds, Ed25519, kept outside the repository: one
  inside the zip's repository, wherever the command is run from, is refused, and so is one in any
  folder git keeps. The zip's repository is the git working tree it is in, or else the nearest
  folder above it with a `package.json`. Its public key goes in the trusted-signers file as
  `{ "id", "kind": "ed25519", "publicKey" }`. `--commit` is the commit the zip was built from, the
  `HEAD` of the zip's repository by default, refused with anything uncommitted. `--ephemeral-key --signers-out` makes a key for the run, never written, and writes
  its public half as a trusted-signers file.
- **`sign --keyless`,** in the customer's CI: the decision whether the run may sign, for a tag build
  of the package, on GitHub's runners, with an OIDC identity, by a workflow the trusted signers
  name, and the predicate `actions/attest` then signs through Sigstore with the run's identity. No
  key is kept anywhere. Off a tag build it refuses; with no identity, or from a fork, it says why
  and signs nothing.
- **`verify`** holds a zip to its signature, `<zip>.sig.json` unless `--signature` names another,
  and to the trusted signers: a changed byte, a signer not among them, and another version, by the
  zip's name, its `package.xml` or `--version`, are each refused. A keyless signature is checked by
  `gh attestation verify`.

## Releasing: `release-check`

```bash
satori release-check config-packages/acme-config --kits config-packages --previous <zip installed now>
```

Publishing is a person's step: a tag `app-package/<name>/<version>`, pushed on purpose, which the
workflow builds again and signs once it is configured. `release-check` checks what can be checked
before the tag, and says the tag:

1. the package builds and passes every step, by this tool's own `build`, into a scratch folder it
   removes; one that does not build is not ready;
2. with `--previous`, the package as it is installed, a folder or its zip, it is held to that one,
   as `upgrade-check` holds it; without it, the answer says its upgrade was not checked;
3. its tag, from the `package.xml` of the zip just built, is not a ref of the git repository the
   package is in. A tag someone pushed that this clone has not fetched is not seen, which it says;
   a package in no git repository is not ready, since a person tags it with git;
4. ready, it prints the two commands a person runs on the merged commit, the tag and its push.

It never makes or pushes a tag, never calls the Marketplace, and reads no credential: git is asked
for its top folder and one ref. `--json` prints one JSON object, which the MCP server's
`release_check` reads. The check is `scripts/package-pipeline/release-check.mjs`, which this
repository's `scripts/app-release-check.mjs` runs too, over `app-package.mjs`. Exit codes: 0,
ready; 1, not ready; 2, the command was wrong or could not be run.

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
library builds now, so the tool's validator and the server's are always the same source's.

For `agents sync` it carries `agents/`, the skill and the section. For `mcp` it calls
[`tools/builder-mcp/bundle.mjs`](../builder-mcp/bundle.mjs), which writes `mcp.mjs`, the server,
`mcp-generator.mjs`, its generators' process, `generators/`, what the generators read outside a
package, and `licenses/`, the licence of each package bundled. Those two bundles alone carry what
is installed, the server the MCP SDK and zod, the generators' process Prettier and EJS, and
`bundle.mjs` refuses anything else; `satori.mjs` and `validator.mjs` still carry nothing installed.
The folder is what `npm pack` packs. Node 24 and the system's `unzip` run it, and `gh` verifies a
keyless signature.

## Its controls

`node tools/satori-cli/selftest.mjs`, the project's `test` target, builds the tool, then:

- builds every kit in `business-apps/packages/` through `app-package.mjs` and through the tool, and
  requires the same SHA-256, and the same report from the validator through `bin.mjs` and through
  the tool's `validator.mjs`; a tool whose builder differs by one byte must build another digest;
- packs it with `npm pack`, unpacks it into a folder with no `node_modules`, and builds a copy of a
  kit there, to the same digest, and a repository `create` writes, under Node's permission model,
  so that no Node process of the run can read anything outside that folder: reading this
  repository's `package.json` from it must fail;
- builds the tool a second time from another folder, which must give the same bytes;
- in that folder, starts `satori mcp` from the tarball in the scaffold, confined by flags on its
  command line, which Node passes on to every Node process it starts, as it would not pass
  `NODE_OPTIONS` on to the ones the server starts with an environment of its own; and requires its
  tools to be the repository's server's, by name, title, annotations and every argument, and what
  they say to name nothing of this repository's, which the repository's own server's do;
  `validate_package` to pass the scaffold; a generator's write to be kept; a write with an
  unregistered widget refused with the package unchanged; and `preview_package` to refuse. A
  process a confined one starts with no environment must not read this repository either, and no
  file the tarball ships may name this repository's folder or the builder's home;
- signs the scaffold's zip there with a key made at run time and with one held outside the
  repository, and refuses a key inside it, from the repository and from another folder, a key in
  another repository git keeps, a changed byte, a signer not trusted, and another version three
  ways, `verify` with no trusted signers, and `--keyless` off a tag build;
- in the scaffold, by then a git repository, runs `release-check`, through the command and through
  the server's `release_check`: ready, with the tag and push, held to its own zip as `--previous`,
  and with no tag made; then not ready once that version is tagged, and for a package that does not
  build; and refuses `--out`, and no package;
- runs every app generator, in the order a kit is made, through the repository's runner, with Nx's
  tree and Prettier, and through the bundled one, on the same package, and requires the same bytes;
  the bundled one given another print width must answer otherwise;
- runs `agents sync` with credentials and an address in the environment, none of which may be in a
  file it writes; again, which must touch no file; with a customer's text around the section, which
  must be kept to the byte, and the entry alone edited, both of which `--check` must see and the
  sync put back; with a customer's own servers in their own layout and this version's entry, which
  `--check` must find in step and the sync leave as it is, and with a stale entry, put back with
  their servers kept; and with a marker repeated, an MCP file that is not JSON, one JSON would not
  give back, and a link, each refused with nothing written. A planted secret, and an edit planted
  inside the section, must be seen;
- holds the customer's skill to naming every tool the server has and nothing of this repository's,
  which this repository's own skill fails, and the workflow `create` writes to checking the agent
  files and signing only in its one job with an identity, and only once configured: each of three
  breaks of it is seen;
- refuses, each at its own step: a layout's unregistered widget, a Layer 1 key, a Layer 0 key and a
  preset's the application does not read, a property the model does not have, a name Satori uses in
  `create`, in a package and in a fragment, a home with no `app.json`, a key the builder refuses, a
  symbolic link, and the command's own errors; and passes a scaffold, a package mixing every layer,
  a package with an older `build.mjs`, the upgrade check against a folder and a zip, and
  `model pull` against a stand-in server, which must get the credentials in a header only;
- holds the names Satori uses to the generator's, in both its copies.

## Not in this slice

- **Publishing the tool,** and so the workflow's `npm ci`, which needs it on a registry: decision K's
  owners. And publishing a package, which stays a person's tag: `release-check` says the tag.
- **A preview against the customer's development server.** `preview_package` serves to this
  repository's development server only, and refuses outside it.
- **Promotion** through development, test and production with a person's approval, and **who may
  sign** for a deployment: decision M.
- **What a generator names of this repository.** A file a generator writes names its JSON Schema by
  this repository's path, `libs/shared/app-definition/src/...`, and its closing message names the
  command to run as `npm run app-package`; in a customer's repository both point at nothing. The
  bundled generators write what the repository's write, byte for byte, which the controls hold
  them to, so changing that is a change to the generators.
- **Windows.** Nothing here has been run on it, and `.mcp.json` starts `node_modules/.bin/satori`,
  which is a `.cmd` there.
