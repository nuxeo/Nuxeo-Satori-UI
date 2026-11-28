## Nuxeo Satori: the commands

Run them from this folder. The tool is a dev dependency, pinned in `package.json`; run it from
`node_modules/.bin`, never with `npx satori`, which fetches whatever has that name when the
install did not put it there.

| To                                                         | Run                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Check a package after every change, writing nothing        | `./node_modules/.bin/satori validate config-packages/<package> --kits config-packages`         |
| Build its Marketplace zip and checksum into `dist/`        | `./node_modules/.bin/satori build config-packages/<package> --out dist --kits config-packages` |
| Write the development server's content model to a file     | `./node_modules/.bin/satori model pull --server <address> --out content-model.json`            |
| Hold layouts, queues and page providers to that model      | add `--model content-model.json` to `validate` or `build`                                      |
| Hold a new version to the one installed, before releasing  | `./node_modules/.bin/satori upgrade-check config-packages/<package> --previous <zip>`          |
| Sign a zip with a key you hold, outside this repository    | `./node_modules/.bin/satori sign dist/<zip> --key <file>`                                      |
| Verify a zip against the signers you trust                 | `./node_modules/.bin/satori verify dist/<zip> --trusted-signers trusted-signers.json`          |
| Refresh this section, the skill and the MCP server's entry | `./node_modules/.bin/satori agents sync`, after every upgrade of the tool                      |

`validate` and `build` take the same steps and refuse the same things; each refusal names the step,
the file, the place and the reason. A change is done when `validate` passes.

## Nuxeo Satori: building with an agent

- **The skill:** `satori-app-builder`, in `.cursor/skills/`, `.claude/skills/` and `.agent/skills/`.
  Read it before writing a package.
- **The MCP server:** `nuxeo-satori`, in `.mcp.json` and `.cursor/mcp.json`, which runs
  `satori mcp`. It reads the development server's content model, page providers, workflows,
  vocabularies and operations, and writes a package's file only when the package then passes
  `satori validate`'s steps. Write every package file through it, never with your own file tools.
- **Its server and account come from the environment:** `NUXEO_URL`, `NUXEO_USER` and
  `NUXEO_PASS`, exported in the shell the IDE starts from. They are never written in a file here.

## Nuxeo Satori: where things go

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

## Nuxeo Satori: rules

- **Validate every change before it is committed,** and keep only what validates.
- **Nothing secret, ever.** A fragment is served before sign-in, without authentication: no
  password, token, private address or customer's real data in any file here.
- **The server's address and credentials come from the environment,** `NUXEO_URL`, `NUXEO_USER`
  and `NUXEO_PASS`, never from a file in this repository and never in an address.
- **A signing key is never in this repository.** `satori sign --key` refuses one inside it.
- **Hiding something is not a security control.** Nuxeo's permissions decide what each user may do.
- **Raise the version for every change that is installed:** `package/package.xml`, and with an app
  definition `app.json`'s `packageVersion` and the manifest's `Bundle-Version`, together. Nuxeo
  keeps a package of the same version.
- **Do not edit `build.mjs` or `schema/`** in a package: they are the platform's, and the tool
  builds with its own.
- **Do not use a name Satori itself uses,** `defaults` or `nuxeo-agentic-ui`, for a package or a
  fragment.

## Nuxeo Satori: not in this version

A preview against your development server, promotion through development, test and production,
and who may sign for a deployment (decision M), are later versions of the tool.
