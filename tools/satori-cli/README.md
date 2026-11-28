# @nuxeo/satori-cli

The one builder of a customer's Nuxeo Satori configuration, and what lets their own AI IDE build
with it: decision K's tools ([extension-model.md](../../docs/business-apps/extension-model.md),
section 5). A customer keeps all of their configuration in one repository of their own, and checks,
builds and signs it with this tool, and builds it with an agent through its MCP server, outside this
repository, with Node alone.

**Published, with the `alpha` tag.** 0.4.0 has been on Nuxeo's npm registry,
`https://packages.nuxeo.com/repository/npm-public/`, since 28 November 2026, after 0.3.0 the same
morning, and anyone can read it with no token. [`publish-satori-cli.yml`](../../.github/workflows/publish-satori-cli.yml) publishes
each version when a person dispatches it ([Publishing it](#publishing-it)). The tool has the `alpha`
tag and no `latest`, so a command names `@alpha` or an exact version: `npm view @nuxeo/satori-cli`
without either prints nothing. A version not published yet is built from this repository and run from the folder it is
built into, or from a tarball `npm pack` makes of that folder. A customer's
guide, from nothing to a signed release with the published tool, is
[customer-config-repository.md](../../docs/business-apps/customer-config-repository.md).

## The commands

```bash
satori validate <package> [options]
satori build <package> [--out <directory>] [options]
satori upgrade-check <package> --previous <directory or zip> [--deployment <file>] [--json] [--tmp <directory>]
satori model pull --server <address> --out <file>
satori create <directory> --name <name> --owner <prefix> [--title <text>] [--vendor <text>]
satori agents sync [<directory>] [--check]
satori connect [<directory>] [--server <origin>] [--user <name>] [--password-stdin] [--check]
satori tool --list | satori tool <name> ['<arguments as JSON>']
satori version <package> <x.y.z | patch | minor | major>
satori mcp [--root <directory>] [--tmp <directory>]
satori sign <zip> (--key <file> | --ephemeral-key --signers-out <file>) [--commit <sha>] [--out <file>]
satori sign <zip> --keyless --trusted-signers <file> --predicate-out <file>
satori verify <zip> --trusted-signers <file> [--signature <file>] [--name <package>] [--version <version>] [--trusted-root <file>] [--tmp <directory>]
satori release-check <package> [--previous <directory or zip>] [--json] [options]
```

`validate`, `build` and `release-check` take `--tmp <directory>` among their options.

- **`connect`** gives the MCP server the development server's address and an account, for an AI
  IDE that does not start it from a shell, as the Claude desktop app does not.
  - It asks for them: the password unshown, from a terminal, or from standard input with
    `--password-stdin`. With neither, it refuses.
  - It checks them against `GET /nuxeo/api/v1/me`, with the MCP server's own rule for the
    address.
  - It writes them into `.claude/settings.local.json`'s `env` at mode 0600. It refuses unless the
    folder is a git repository that ignores the file and does not track it.
  - It never prints the password. `--check` writes nothing and says whether the server answers.
- **`tool`** calls one of the MCP server's tools from the command line. It starts `satori mcp`,
  asks it once over stdio, and prints the answer, so a read is the server's and a write is its
  validated write. It exits 1 when the tool or the pipeline refused. This is for an IDE that cannot
  run the server, such as under an organisation's policy that allows only the MCP servers it
  lists: the Claude Code trial on 28 November 2026 ran under such a policy, and built a whole app
  through it.
- **`version`** raises a package's version in `package/package.xml`, the bundle's
  `Bundle-Version` and `app.json`'s `packageVersion` together. It refuses a version that is not
  higher, and a package whose three disagree.
- **`validate`** takes every step `build` takes and writes nothing: the zip is built and verified
  in a scratch folder, which is then removed.
- **`build`** writes the package's Marketplace zip and its `.sha256` into `--out`, the package's
  `dist/` by default, and with `--previous` its changelog.
- **`upgrade-check`** holds the package to the package it was, a folder or the zip it was built
  into: what a customer may override or name in it is removed only with a migration note, and its
  version rises as far as that needs ([package-pipeline.md](../../docs/business-apps/package-pipeline.md),
  section 10).
- **`model pull`** writes a server's content model to a file, for `--model`. It only reads,
  `GET`s of `/api/v1/config/`, as `NUXEO_USER` with `NUXEO_PASS`, from the environment. It makes
  the folder `--out` names when it is not there, as `build` makes its `--out`, so that
  `--out tmp/content-model.json` works in a repository `create` wrote, which has no `tmp/`. Under
  Node's permission model, an `--out` it may not write and read is refused before the server is
  asked. A file that cannot be written once the server has answered exits 2, and says the model
  was read.
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

**Temporary files, and Node's permission model.** Every temporary file a run makes, and every
process it starts, the validator, the builder, `unzip` and the tool again for `release-check`, is
in one place, so that `--allow-fs-write` on the folders a run works in is enough:

- **`--tmp <directory>`,** on `validate`, `build`, `upgrade-check`, `release-check`, `verify` and
  `mcp`: a folder of the run's own is made in it and removed when the command ends, and the
  directory is removed too if the run made it and left it empty;
- **else `build` works in its `--out` folder,** the package's `dist/` by default, which it writes
  anyway, and leaves only the zip, its checksum and its changelog there;
- **else the system's temporary folder,** as before. Under the permission model, `validate`,
  `release-check` and `mcp`, which always make one, and `upgrade-check` given a zip, are refused
  before they start, with `--tmp` named, when they may not write it; `verify`, which makes one
  only to check a keyless signature, is not, and needs `--tmp` for one. A `--tmp` inside the
  package's `bundle/` or `package/`, which are packaged, is refused.

Under the permission model, the tool also refuses an `--allow-fs-read` or `--allow-fs-write` path
that is not absolute, before it starts: Node passes the flags as written to every Node process the
tool starts, and each reads a relative path from its own working folder, the builder from the
package's, so it would be allowed another folder than the one meant.

The tool sets `TMPDIR`, `TEMP` and `TMP` of its own process to the run's folder, so the package
pipeline's modules, which ask `os.tmpdir()`, and every process the run starts, write there and
nowhere else. Without this, `satori build` made its step 5 folder in `os.tmpdir()`, and stopped
with `ERR_ACCESS_DENIED` under `--allow-fs-write=<the work folder>`.

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

The file `--model` names is read before any step, for every package: one that is not there, a
folder, or one that cannot be read whole as a content model stops `validate`, `build` and
`release-check` with exit 2, the command's error. Only an app definition's step 2 holds anything to
the model, so without that read a package that is configuration alone, with no `app.json`, would
pass, given a file that does not exist, and say nothing of it.

## A customer's repository

```bash
satori create acme-satori --name acme-config --owner acme
```

```text
acme-satori/
  package.json                   @nuxeo/satori-cli as a dev dependency, pinned
  .npmrc                         @nuxeo's registry, Nuxeo's, which npm install and Renovate read
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

**Since 0.4.0, for the Claude app as well:**

- `CLAUDE.md`'s section imports `AGENTS.md` (`@AGENTS.md`), since Claude Code reads `AGENTS.md`
  only while there is no `CLAUDE.md`.
- `.claude/settings.json` gets the tool's entries, each an item of a list, everything else kept:
  - `nuxeo-satori` in `enabledMcpjsonServers`;
  - the MCP server's tools, `mcp__nuxeo-satori`, and the checks and builds in `permissions.allow`: `npm run validate` and `build`, and
    `satori validate`, `build`, `upgrade-check`, `release-check`, `version`, `agents sync` and
    `connect --check`;
  - reading and editing `.claude/settings.local.json` in `permissions.deny`.
- Not allowed without asking: `connect`, `sign`, `model pull` (how a package takes a stand-in
  model), `npm` installs and `git push`. The selftest refuses a version that allows them.

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

**The reference, since 0.4.0.** The package carries a knowledge pack for the agent, and the
server's `read_reference` lists and reads it in any AI IDE.

- **`knowledge/`:** this folder's authored files, which are every file a package holds, the
  recipes, a worked claims app and branding. Beside them, `theme-tokens.md` and `registered.md`,
  which the build writes from the pipeline's token list and the platform snapshot, so they say what
  this version checks.
- **`examples/`:** the kits' app definitions, read-only, with no `$schema` naming this repository.

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

It never makes or pushes a tag, never calls the Marketplace, and reads no credential: it refuses
`--model-server`, which would send `NUXEO_USER` and `NUXEO_PASS` to a server, and takes `--model
<file>`; what it runs gets only `PATH`, the temporary folder, the locale and `NODE_OPTIONS`; and git
is asked for its top folder and one ref, exactly. The package's names are compared with the other
packages in its folder, as the workflow compares them, unless `--kits` names another. `--json` prints one JSON object, which the MCP server's
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

## Publishing it

**What is published.** The build writes the published `package.json` field by field from this
project's, the fields [`published.mjs`](published.mjs) names: not `private`, which this project's
keeps so that its folder of sources cannot be published by mistake; `publishConfig` with
`access: public` and Nuxeo's registry; `bin`, `satori`; `engines`, Node 24 or later; the licence,
Apache-2.0, as the Marketplace packages this repository ships declare; and `files`, the list
above. No `scripts` and no dependency, so installing it runs nothing and fetches nothing else. Its
`README.md` is [`README.npm.md`](README.npm.md), written for a reader of the registry: it links by
`https://` alone, since a path of this repository leads nowhere there.

**What may not be in it.** [`pack-check.mjs`](pack-check.mjs) asks npm what it would pack,
`npm pack --dry-run --json`, and refuses a tarball that holds anything but those files: a source
map, a test or a fixture, a key or an archive, a hidden file of a working copy, a file of
`node_modules`, text shaped like a private key or a token, or this repository's folder or the
builder's home named in a file. The only code from `node_modules` is what `bundle.mjs` bundles into
`mcp.mjs` and `mcp-generator.mjs`, with each package's licence in `licenses/`. `LICENSE` is the Apache
License 2.0's text, byte for byte as the Apache Software Foundation gives it. At 0.4.0 the tarball
is 197 files, 1.9 MB packed and 7.8 MB unpacked, 132 of them the knowledge pack and the examples.

**How it is published.** [`publish-satori-cli.yml`](../../.github/workflows/publish-satori-cli.yml),
which follows `publish-platform.yml`: dispatched by hand, a dry run unless `dryRun` is false, and
`version_bump` `none` by default, which publishes the version this project's `package.json` has.
Its `build` job, which holds no registry token, installs, builds, runs the selftest, packs the
tarball once, holds that tarball, unpacked, to `pack-check.mjs`, and dry-runs the publish of that
file; its `publish` job, which checks nothing out, publishes that same file alone, once its name is
the tool's tarball's and it is in the artifact, with `NPM_PACKAGES_TOKEN`, `--tag alpha`,
`--ignore-scripts` and Nuxeo's registry, and never `latest`. A workflow can be dispatched only once
it is on the repository's default branch, `main`.

**0.4.0 was published the same day,** at 10:09 UTC, from the merge of #805, `a2eeada85`. It has 197 files, with the shasum `e3867c1206bc49e40dce4954ede1ee3a3aca9800`, which the registry serves. From the registry, with no token, these then ran: `create`, `npm install`, `agents sync --check`, `validate` and `satori tool --list`.

The first publish, 0.3.0, ran on 28 November 2026, from `staging/enterprise-grade-app`, after a dry
run of the same commit. Both packed the same tarball, 65 files with the shasum
`b8b782ce6ffdf2e7c20696473c56e3d5a6a59c6c`, and the registry serves that shasum.

The same day it was installed from the registry as a customer would, on macOS with Node 24, an
empty npm configuration and no token in the environment. These ran as the customer guide gives
them, and each passed:

- `npx … @nuxeo/satori-cli@alpha create`;
- `npm install` through the `.npmrc` it wrote, which took one package, at the published integrity;
- `agents sync --check`, `validate` and `build`;
- after the commit, `npm ci` with an empty cache and the workflow's steps, which left the working
  tree clean.

`build` wrote a three-file zip with the same sha256 as `validate`'s scratch build. A key the
application does not read, added to `bootstrap.json`, was refused at step 2 with exit 1.

`checkPublishWorkflows` in `scripts/review-guardrails.mjs` holds both publish workflows to that: a
token, in any letter case or as `secrets['...']`, in a job that checks the repository out, runs
`npm ci`, `node`, `git` or another's action, or in more than one job, or at the workflow's level; a
publish job whose `if:` is more than `!inputs.dryRun`; a trigger other than a dispatch; `dryRun`
false by default; a write permission; runs not serialised; a publish without one `--tag alpha`, to
another registry, or, with the token, without `--ignore-scripts`; the `latest` tag; and any
workflow handing every secret on at once, `toJSON(secrets)` or `secrets: inherit`. Who may
dispatch, and from which branch, no workflow text shows: a protected environment holding the token,
limited to `main` with required reviewers, is the repository's settings to make.

## Its controls

`node tools/satori-cli/selftest.mjs`, the project's `test` target, builds the tool, then:

- builds every kit in `business-apps/packages/` through `app-package.mjs` and through the tool, and
  requires the same SHA-256, and the same report from the validator through `bin.mjs` and through
  the tool's `validator.mjs`; a tool whose builder differs by one byte must build another digest;
- runs `pack-check.mjs` on the tool as it is built, which must pass, and on ten copies of it, each
  with one thing planted, a `private` package.json, another registry, an install script, a source
  map, an `.npmrc` npm would leave out of the tarball, a fixture, a private key made at run time, a
  token assembled at run time, this repository's folder, and a README linking by a path of this
  repository: each must be refused;
- packs it with `npm pack`, unpacks it into a folder with no `node_modules`, and builds a copy of a
  kit there, to the same digest, and a repository `create` writes, under Node's permission model,
  so that no Node process of the run can read or write anything outside that folder: reading this
  repository's `package.json` from it must fail, and so must making a folder in the system's
  temporary folder, which `TMPDIR` still names. So the kit's build, with its `--out` and into the
  package's `dist/`, passes only because it keeps its temporary files there, and leaves nothing
  else; an `--out` outside the folder is refused before anything runs; `validate`,
  `release-check`, `mcp`, and `upgrade-check` of a zip, are refused without `--tmp` and pass with
  it; a `--tmp` inside the package's `bundle/` is refused; and so are the permission model's paths
  given relative, on the command line and in `NODE_OPTIONS`;
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
  build; and refuses `--out`, no package, and a `--model` that names no file;
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
  symbolic link, and the command's own errors, among them a `--model` that names no file, a folder
  or a file that is not JSON, for a package with no `app.json`, through `validate`, `build` and
  `app-package.mjs`, and for an app definition, each with exit 2, and the zip a build wrote before
  removed; and
  passes a scaffold, a package mixing every layer, a package with an older `build.mjs`, the upgrade
  check against a folder and a zip, and `model pull` against a stand-in server, which must get the
  credentials in a header only, and must make `--out`'s folder when it is not there: as
  customer-config-repository.md gives it, `--out tmp/content-model.json`, in a repository `create`
  has just written, under the permission model, after which `validate --model` takes the file. An
  `--out` the permission model does not allow is refused with no request to the server, and an
  `--out` that cannot be written is said as that, with exit 2, not as a model not read;
- holds the names Satori uses to the generator's, in both its copies.

## Not in this slice

- **Publishing a package,** which stays a person's tag: `release-check` says the tag.
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
