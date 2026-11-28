# Your configuration repository, from nothing

For a customer or a partner: a repository of your own that holds all of your Nuxeo Satori
configuration, branding, the menu, and the app definitions your users work in, checked, built and
signed with `@nuxeo/satori-cli`, the tool Nuxeo publishes for it. You need nothing of this
repository: not a clone, not its build, and no token.

The tool is version 0.3.0, published with the `alpha` tag: what it checks and the files it writes
can still change between versions, and each change is in its release notes. It has no `latest` tag
yet, so name `@alpha` or an exact version: `npm view @nuxeo/satori-cli` without either prints
nothing.

## 1. What you need

- **Node 24** or later, and **git**. `unzip`, which every Linux and macOS has, reads the zips back.
- **No token.** The tool is on Nuxeo's npm registry, `https://packages.nuxeo.com/repository/npm-public/`,
  which anyone can read. It has no dependency, so installing it fetches nothing else, and nothing
  of Hyland's that needs a token. The read token Nuxeo Satori UI's own build uses,
  `SATORI_GH_READONLY_TOKEN`, is for that repository's packages on GitHub Packages; you never need
  it.
- **For the agent:** an AI IDE that reads a skill and starts an MCP server, Cursor or Claude Code,
  say. Optional: everything it does, you can do by hand.
- **For installing:** a Nuxeo development server with Nuxeo Satori installed, and its address and an
  account to read its content model with.
- **For CI:** a GitHub repository. The workflow the tool writes runs on GitHub Actions.

## 2. Create the repository

npm's own registry does not have the tool, so point the `@nuxeo` scope at Nuxeo's for this one
command:

```bash
npx --@nuxeo:registry=https://packages.nuxeo.com/repository/npm-public/ \
  @nuxeo/satori-cli@alpha create acme-satori --name acme-config --owner acme
```

`--name` is your package's name, which becomes the Marketplace package's; `--owner` prefixes its
Nuxeo component, `acme.config.acme-config`, so that it collides with nothing of ours. A name Satori
uses itself, `defaults` or `nuxeo-agentic-ui`, is refused, with nothing written. The folder must be
new or empty.

```text
acme-satori/
  package.json                   @nuxeo/satori-cli as a dev dependency, pinned to this version
  .npmrc                         @nuxeo's registry, Nuxeo's, so that npm install finds the tool
  AGENTS.md                      your part, then the tool's section: the commands and the rules
  .cursor/skills/  .claude/skills/  .agent/skills/
                                 satori-app-builder, the app builder skill
  .mcp.json  .cursor/mcp.json    the MCP server, satori mcp, with nothing secret in it
  .gitignore                     node_modules/, dist/, and tmp/
  .github/workflows/satori.yml   validate and build every change; sign a tag once configured
  config-packages/acme-config/   your first package: Layer 0, Layer 1 and its component
```

Then install the tool, which `.npmrc` sends npm to Nuxeo's registry for, and make it a repository:

```bash
cd acme-satori
git init
npm install
git add .
git commit -m "A Nuxeo Satori configuration repository"
```

Commit `package-lock.json`: the workflow installs exactly what it pins, with `npm ci`. Push it to
your Git host when you have made the repository there.

Run the tool from `node_modules/.bin`, or through the `validate` and `build` scripts `package.json`
defines. Never `npx satori`: when the install has not put the tool there, `npx` fetches whatever
package npm's registry has under that name.

## 3. Ask your AI IDE for a page

`create` installed the agent files, so open the repository in your IDE. After each upgrade of the
tool, refresh them:

```bash
./node_modules/.bin/satori agents sync           # writes what this version writes
./node_modules/.bin/satori agents sync --check   # writes nothing; exit 1 names what differs
```

It writes the app builder skill, as `satori-app-builder`, into `.cursor/`, `.claude/` and
`.agent/`, `AGENTS.md`'s section between its two markers, and the server `nuxeo-satori` into
`.mcp.json`, which Claude Code reads, and `.cursor/mcp.json`, which Cursor reads. Your own text in
`AGENTS.md` outside the section, and your own servers in the MCP files, are kept to the byte.

**The server's address and credentials come from your environment, never from a file.** The MCP
entries name `NUXEO_URL`, `NUXEO_USER` and `NUXEO_PASS` as references, which the IDE fills in when
it starts the server, so set them in the shell you start the IDE from:

```bash
export NUXEO_URL=https://nuxeo-dev.acme.example     # the server's origin, without /nuxeo
export NUXEO_USER=<an account of the development server>
export NUXEO_PASS=<its password>
```

Use a development server, never production: what the tools read goes to the agent.

Then ask the agent for what you want, in your own words:

> Add a record page for our `Claim` documents: the claimant, the amount and the status at the top,
> the documents attached below, and an Approve button that runs our `Claim.Approve` operation.

The agent reads the skill and `AGENTS.md`, and works through the MCP server's tools. It reads your
server's types, schemas, page providers, workflows, vocabularies and operations, and writes the
files through the same generators Nuxeo uses. **A write is kept only if the package still passes
`satori validate`**: one that names a widget that does not exist, or a property your type does not
have, is refused, and the package is left as it was. `preview_package` refuses in your repository,
since it serves only to Nuxeo Satori UI's own development server: you see the page by installing
the package (section 5).

To check a package against your server's content model offline, write the model to a file once:

```bash
./node_modules/.bin/satori model pull --server "$NUXEO_URL/nuxeo" --out tmp/content-model.json
```

and give it to `validate` and `build` with `--model tmp/content-model.json`. `tmp/` is ignored by
git: the model is your server's, and is not committed.

## 4. Validate, build and release-check

```bash
./node_modules/.bin/satori validate config-packages/acme-config --kits config-packages
./node_modules/.bin/satori build config-packages/acme-config --out dist --kits config-packages
./node_modules/.bin/satori release-check config-packages/acme-config --previous <the zip installed now>
```

- **`validate`** takes every step `build` takes, and writes nothing. The steps are the package
  pipeline's: no symbolic link, every key of Layer 0 and Layer 1 one the application reads, the app
  definition held to the platform's schemas and to your content model, no name Satori uses, the zip
  built, read back by a reader that did not write it, and its checksum.
- **`build`** writes `dist/acme-config-1.0.0.zip` and its `.sha256`.
- **`release-check`** says whether the package is ready for a person to release: it builds, keeps
  what `--previous` had, and its tag, `app-package/acme-config/1.0.0`, is not one git has. Ready, it
  prints the two commands that tag it and push the tag. It never tags, pushes or publishes.
- **`upgrade-check`** holds the package to the one installed now on its own:
  `satori upgrade-check config-packages/acme-config --previous <zip>`.

Exit codes: 0, done or ready; 1, refused or not ready, with the file and the reason; 2, the command
was wrong, or could not be run. `satori --help` gives every option.

**Under Node's permission model,** allowing the repository's folder is enough. `build` makes its
temporary files in its `--out` folder; `validate`, `release-check` and `mcp` need `--tmp`, and
refuse, before they start, without it:

```bash
node --permission --allow-fs-read="$PWD" --allow-fs-write="$PWD" --allow-child-process \
  node_modules/.bin/satori validate config-packages/acme-config --kits config-packages --tmp tmp
```

`--allow-child-process` lets the tool run its validator and its builder, which Node confines in the
same way, and the system's `unzip` and `git`. Give the paths absolute, as `"$PWD"` makes them: Node
passes the flags as written to each Node process the tool starts, and each would read `.` from its
own working folder, the builder from the package's. The tool refuses a relative path before it
starts. `verify` needs `--tmp` only to check a keyless signature.

## 5. Install the zip on a development server

Copy the zip to the server and, as the user Nuxeo runs as:

```bash
nuxeoctl mp-install acme-config-1.0.0.zip
```

Then restart Nuxeo: the server reads the configuration at startup. To see it took,
`curl https://nuxeo-dev.acme.example/nuxeo/agentic-ui-config/bootstrap.json` returns your values
merged over Satori's. To go back, `nuxeoctl mp-remove acme-config` and restart. Raise the version
in `config-packages/acme-config/package/package.xml` for each change you install: Nuxeo keeps a
package it already has at the same version. [CUSTOMISING.md](../../CUSTOMISING.md), sections 5 and
"If something goes wrong", says more.

## 6. CI

`.github/workflows/satori.yml` runs on every pull request and every push to `main`, with
`permissions: contents: read`:

1. `npm ci`, which installs the tool `package-lock.json` pins, from Nuxeo's registry, with no token;
2. `satori agents sync --check`, so a version whose agent files were not refreshed is seen;
3. `satori validate` and `satori build` of every package in `config-packages/`;
4. the zips, uploaded as the run's artifact `configuration-packages`.

Nothing in it publishes a package or installs it anywhere.

## 7. Signing, once you have `trusted-signers.json`

Who may sign a package for a deployment is yours to decide, and the tool trusts no one by default.
Once a `trusted-signers.json` at the repository's root names the workflow, a tag the workflow
builds is signed:

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

Then a person releases by pushing the tag `release-check` printed:

```bash
git tag app-package/acme-config/1.0.0
git push origin app-package/acme-config/1.0.0
```

The tag's run builds the zip again, and its `sign` job, the workflow's one job with an identity,
signs it keyless through Sigstore with the run's GitHub identity, verifies it, and uploads its
signature, `<zip>.sig.json`, as the run's artifact. With no `trusted-signers.json`, the job says signing is not configured and signs nothing; from a
fork, or a workflow the file does not name, it signs nothing either. Anyone can check a zip before
installing it:

```bash
./node_modules/.bin/satori verify dist/acme-config-1.0.0.zip --trusted-signers trusted-signers.json
```

A keyless signature is checked with the GitHub CLI, `gh`. To sign with a key you hold instead,
`satori sign <zip> --key <file>`, with the key kept outside the repository, and its public half in
`trusted-signers.json` as `{ "id", "kind": "ed25519", "publicKey" }`.

## 8. Upgrading: bump the version

Each version of the tool carries the checks of the platform version it was built for. To upgrade,
bump it, refresh the agent files, and commit both:

```bash
npm install --save-dev --save-exact @nuxeo/satori-cli@<version>
./node_modules/.bin/satori agents sync
./node_modules/.bin/satori upgrade-check config-packages/acme-config --previous <the zip installed now>
git commit -am "@nuxeo/satori-cli <version>"
```

Renovate or Dependabot can open that pull request for you: `.npmrc` tells them where the tool is.
The workflow then holds every package to the new version's checks, and `agents sync --check` fails
until the agent files are this version's.

## 9. A version not published yet: from a tarball

To try a version before it is on the registry, someone at Nuxeo builds its tarball from Nuxeo
Satori UI's repository, `node tools/satori-cli/build.mjs`, then `npm pack dist/tools/satori-cli`,
and gives you `nuxeo-satori-cli-<version>.tgz`. The same commands then work with the tarball in
place of the registry, with `<version>` the tarball's:

```bash
npx --package ./nuxeo-satori-cli-<version>.tgz satori create acme-satori --name acme-config --owner acme
cd acme-satori
npm install --no-save ../nuxeo-satori-cli-<version>.tgz
```

`--no-save` keeps the registry's version in `package.json`, so the repository is the one the
published tool writes, and writes no `package-lock.json`. Until that version is on the registry,
the workflow's `npm ci` refuses to run: run `npm install` once it is, and commit the
`package-lock.json` it writes.

## 10. Not there yet

- **A preview against your development server.** The agent cannot show you the page before you
  install the package.
- **Promotion** from a development server through test to production, with a person's approval,
  and **who may sign** for each deployment: Nuxeo's decision M leaves both open.
- **Reusable workflows** your workflow calls, so that a fix to a check reaches you without a
  version bump.
- **Windows.** Nothing has been run on it, and `.mcp.json` starts `node_modules/.bin/satori`, which
  is a `.cmd` there.

For Nuxeo's side of this, how the tool is built, published and tested, see
[the tool's README](../../tools/satori-cli/README.md) and
[extension-model.md](extension-model.md), section 5.
