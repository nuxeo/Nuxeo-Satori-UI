# @nuxeo/satori-cli

The builder of your Nuxeo Satori configuration. One command-line tool, which runs with Node 24 and
nothing else installed, for a configuration repository of your own:

- **`create`** writes the repository: a first configuration package that builds, `AGENTS.md`, the
  app builder skill for your AI IDE, the MCP server's entry, and a GitHub Actions workflow.
- **`validate`** and **`build`** check every file of a package, Layer 0 (`bootstrap.json`), Layer 1
  (`manifest.json`), assets, version 1 layouts and a version 2 app definition, by the checks
  Nuxeo's own pipeline and server make, and build its Nuxeo Marketplace zip.
- **`agents sync`** installs or refreshes the skill, `AGENTS.md`'s section and the MCP server's
  entry for Cursor, Claude Code and any other agent; **`mcp`** is that MCP server, through which
  the agent reads your server's content model and writes files only when the package still passes.
- **`upgrade-check`**, **`release-check`**, **`sign`** and **`verify`** hold a package to the one
  installed now, say when it is ready for a person to tag, and sign and verify its zip.

It has no dependency, runs no install script, and reads no credential but where it says so:
`model pull`, `--model-server` and the MCP server's Nuxeo tools read `NUXEO_URL`, `NUXEO_USER` and
`NUXEO_PASS` from the environment, never from a file.

## Install

It is published to Nuxeo's npm registry, `https://packages.nuxeo.com/repository/npm-public/`,
which needs no token to read. npm's own registry does not have it, so point the `@nuxeo` scope at
Nuxeo's:

```bash
npx --@nuxeo:registry=https://packages.nuxeo.com/repository/npm-public/ \
  @nuxeo/satori-cli@alpha create acme-satori --name acme-config --owner acme
cd acme-satori
git init
npm install            # the .npmrc create wrote points @nuxeo at Nuxeo's registry
git add . && git commit -m "A Nuxeo Satori configuration repository"
```

Versions are published with the `alpha` tag only for now, which `@alpha` names. `create` pins the
version it is, exactly, in the new repository's `package.json`; commit `package-lock.json`, which
the workflow installs from with `npm ci`.

## Use

In the repository, from `node_modules/.bin`, or through the `validate` and `build` scripts
`package.json` defines:

```bash
./node_modules/.bin/satori validate config-packages/acme-config --kits config-packages
./node_modules/.bin/satori build config-packages/acme-config --out dist --kits config-packages
./node_modules/.bin/satori release-check config-packages/acme-config --previous <zip installed now>
./node_modules/.bin/satori --help
```

Then install the zip `dist/` holds on a development server, as the user Nuxeo runs as, and restart:
`nuxeoctl mp-install dist/acme-config-1.0.0.zip`.

Run the tool from `node_modules/.bin`, never as `npx satori`: when the install has not put it there,
`npx` fetches whatever package of that name npm's registry has.

### Under Node's permission model

Every temporary file a run makes goes in its `--out` folder for `build`, or in `--tmp <directory>`,
so allowing the repository's folder is enough:

```bash
node --permission --allow-fs-read="$PWD" --allow-fs-write="$PWD" --allow-child-process \
  node_modules/.bin/satori build config-packages/acme-config --out dist
node --permission --allow-fs-read="$PWD" --allow-fs-write="$PWD" --allow-child-process \
  node_modules/.bin/satori validate config-packages/acme-config --tmp tmp
```

Without `--tmp`, `validate`, `release-check` and `mcp` use the system's temporary folder, and under
the permission model refuse, before they start, when they may not write it. `tmp/` is in the
`.gitignore` that `create` writes. `verify` makes one only to check a keyless signature, so give
it `--tmp` for one. `--allow-child-process` is needed: the tool runs its validator and its builder,
which Node starts with the same permissions, and the system's `unzip` and `git`.

Give the paths absolute, as `"$PWD"` makes them. Node passes the flags as written to every Node
process the tool starts, and each would read `.` from its own working folder: the builder, which
runs in the package's folder, would be allowed another one. The tool refuses a relative path
before it starts.

## Upgrade

Bump the version, refresh the agent files, and commit both:

```bash
npm install --save-dev --save-exact @nuxeo/satori-cli@<version>
./node_modules/.bin/satori agents sync
```

The workflow runs `satori agents sync --check`, so a version whose agent files were not refreshed
is seen. Renovate or Dependabot can open the bump for you: the `.npmrc` tells them where to look.

## Licence

Apache-2.0. `mcp.mjs` and `mcp-generator.mjs` bundle the MCP SDK, zod, Prettier, EJS and part of
`@nx/devkit`; each one's licence is in `licenses/`.

## More

The source, and the guide to a configuration repository from nothing,
`docs/business-apps/customer-config-repository.md`, are in
[Nuxeo Satori UI's repository](https://github.com/nuxeo/Nuxeo-Satori-UI).
