# AGENTS.md

This repository holds one customer's Nuxeo Satori configuration. Each folder of
`config-packages/` is one Nuxeo Marketplace package, which an administrator installs on the
customer's Nuxeo server beside Nuxeo Satori. It is configuration only: JSON, XML and images. Nothing
here is compiled, and nothing here is the platform's source.

Written by `satori create`, from `@nuxeo/satori-cli` {{version}}.

## The commands

Run them from this folder. The tool is a dev dependency, pinned in `package.json`; run it from
`node_modules/.bin`, never with `npx satori`, which fetches whatever has that name when the
install did not put it there.

| To                                                        | Run                                                                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Check a package after every change, writing nothing       | `./node_modules/.bin/satori validate config-packages/{{name}} --kits config-packages`         |
| Build its Marketplace zip and checksum into `dist/`       | `./node_modules/.bin/satori build config-packages/{{name}} --out dist --kits config-packages` |
| Write the development server's content model to a file    | `./node_modules/.bin/satori model pull --server <address> --out content-model.json`           |
| Hold layouts, queues and page providers to that model     | add `--model content-model.json` to `validate` or `build`                                     |
| Hold a new version to the one installed, before releasing | `./node_modules/.bin/satori upgrade-check config-packages/{{name}} --previous <zip>`          |

`validate` and `build` take the same steps and refuse the same things; each refusal names the step,
the file, the place and the reason. A change is done when `validate` passes.

## Where things go

Everything a package does is under `config-packages/<package>/bundle/agentic-ui-config/`:

- `bootstrap.json`: Layer 0, branding, themes, languages, sign-in;
- `manifest.json`: Layer 1, what the application shows: hide, reorder, relabel, gate;
- `assets/`: images a fragment names, each declared as an `<asset>` in `bundle/OSGI-INF/`;
- an app definition, version 2: `app.json`, `home.json`, `navigation.json`,
  `layouts/<Type>/<mode>.layout.json`, `queues/<id>.json`, `actions.json`,
  `tasks/<workflow>.<step>.layout.json` and `labels/<language>.json`. Each is contributed by the
  component in `bundle/OSGI-INF/`: a `<layout>` for each layout, and one `<app>` naming the others.

The JSON Schemas of every file are in `node_modules/@nuxeo/satori-cli/schemas/`. The names a file
may use, its IDs, rules, widgets and slots, are the ones Nuxeo Satori's extension reference
registers: <https://github.com/nuxeo/Nuxeo-Satori-UI/blob/main/docs/extension-reference.md>.

## Rules

- **Validate every change before it is committed,** and keep only what validates.
- **Nothing secret, ever.** A fragment is served before sign-in, without authentication: no
  password, token, private address or customer's real data in any file here.
- **The server's address and credentials come from the environment,** `NUXEO_USER` and
  `NUXEO_PASS`, never from a file in this repository and never in an address.
- **Hiding something is not a security control.** Nuxeo's permissions decide what each user may do.
- **Raise the version for every change that is installed:** `package/package.xml`, and with an app
  definition `app.json`'s `packageVersion` and the manifest's `Bundle-Version`, together. Nuxeo
  keeps a package of the same version.
- **Do not edit `build.mjs` or `schema/`** in a package: they are the platform's, and the tool
  builds with its own.
- **Do not use a name Satori itself uses,** `defaults` or `nuxeo-agentic-ui`, for a package or a
  fragment.

## Not here yet

The app builder skill, the MCP server that reads the development server's model for an agent, and
signing and promotion in the workflow are later versions of the tool.
