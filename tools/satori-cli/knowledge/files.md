# The files of a configuration package

A package is one folder in `config-packages/`. Its files, by where they are in it. The JSON
Schemas are in `node_modules/@nuxeo/satori-cli/schemas/`; an editor reads each from the file's
`$schema`.

## What the agent writes

| File, under `bundle/agentic-ui-config/` | What it is                                                                           | Written with                                 | Schema                   |
| --------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------ |
| `bootstrap.json`                        | Layer 0: branding, themes and their colours, languages, sign-in, read before sign-in | `write_package_file`                         | `bootstrap.schema.json`  |
| `manifest.json`                         | Layer 1: what the app shows, hidden, renamed, reordered or gated, by registered id   | `write_package_file`                         | `manifest.schema.json`   |
| `app.json`                              | The app: its id, name, address, the groups it is served to, the package's version    | `apply_package_changes`, then `app-registry` | `app.schema.json`        |
| `layouts/<Type>/view.layout.json`       | A record page for a type: cards of fields, banners, related lists                    | `app-layout`                                 | `layout-v2.schema.json`  |
| `layouts/<Type>/edit.layout.json`       | Its Edit form; `create.layout.json`, its Create form                                 | `app-form`                                   | `layout-v2.schema.json`  |
| `queues/<id>.json`                      | A work queue: a page provider's records, columns, sort, facets                       | `app-queue`                                  | `queue.schema.json`      |
| `home.json`                             | The app's home: figures, cards, a list of recent records                             | `write_package_file`, then `app-registry`    | `home.schema.json`       |
| `navigation.json`                       | The app's menu                                                                       | `write_package_file`, then `app-registry`    | `navigation.schema.json` |
| `actions.json`                          | Buttons: a lifecycle transition, or an allowed Automation operation                  | `app-action`                                 | `actions.schema.json`    |
| `tasks/<workflow>.<step>.layout.json`   | A workflow step's task form, for a workflow the server has                           | `write_package_file`, then `app-registry`    | `layout-v2.schema.json`  |
| `labels/<language>.json`                | Every text the app definition names by key, in English and other languages           | the generators, or `write_package_file`      | `labels.schema.json`     |

A file of the app definition is written whole, as JSON with `"version": 2`. A new file the
component must name, such as `home.json` or a new queue, needs `app-registry` in the same
`apply_package_changes` call.

## What the generators write, and no one by hand

- `bundle/OSGI-INF/<name>-config.xml`: the component, which names the fragments, the layouts and
  the app. The generators keep it in step.
- `package/package.xml`, `bundle/META-INF/MANIFEST.MF`: the Marketplace package and its bundle.
  Their version, and `app.json`'s `packageVersion`, are one: change it with `satori version`.
- `content-model.json`, `bundle/OSGI-INF/<name>-model.xml`, `bundle/schemas/*.xsd`: a stand-in
  model, for a demo or a prototype only (`app-model`).

## What no tool writes

- `bundle/agentic-ui-config/assets/`: images, such as a logo. A person adds the file, and its
  `<asset>` line in the component; [branding.md](branding.md) says how.
- `deployment/`: the deployment's allow-list of the operations a button may run. A person writes
  it: an agent that wrote it could allow its own operations.
- Code of any kind. A package is configuration only.
