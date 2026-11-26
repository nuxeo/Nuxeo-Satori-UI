# Moves

A Nuxeo Satori business app: an app definition package
([package-pipeline.md](../../../docs/business-apps/package-pipeline.md), section 1). The `app-package` generator
scaffolded it; the files are yours to change.

| File                                                       | What it is                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `bundle/agentic-ui-config/app.json`                        | The app: its id, name, version, platform range and groups    |
| `bundle/agentic-ui-config/labels/en.json`                  | Its labels, in English                                       |
| `bundle/agentic-ui-config/layouts/<Type>/view.layout.json` | A record page, one per document type                         |
| `bundle/agentic-ui-config/queues/<id>.json`                | A queue: a page provider's records, with columns and actions |
| `bundle/agentic-ui-config/actions.json`                    | Its buttons: lifecycle transitions and allowed operations    |
| `bundle/OSGI-INF/moves-demo-config.xml`                    | The component that contributes the layouts to the server     |
| `package/package.xml`                                      | The Marketplace package: name, version, what it depends on   |
| `build.mjs`                                                | Version 1's builder: the generator's, byte for byte          |

What each file may say is [app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md) and
[layout-v2.md](../../../docs/business-apps/layout-v2.md).

## Adding to it

From the repository's root:

```bash
npx nx g ./tools/satori-generators:app-layout --package=business-apps/packages/moves-demo --type=<Type> --model=<content-model.json>
npx nx g ./tools/satori-generators:app-queue --package=business-apps/packages/moves-demo --id=<queue> --pageProvider=<page provider>
npx nx g ./tools/satori-generators:app-action --package=business-apps/packages/moves-demo --id=moves.<name> --transition=<transition>
```

## Checking and building it

```bash
npm run app-package -- business-apps/packages/moves-demo --platform <platform version>
```

It writes `dist/moves-demo-<version>.zip`. `--model <file>` holds the layouts to a server's
content model; `npm run app-package:model` exports one. A version is raised in three places,
together: `package/package.xml`, `app.json`'s `packageVersion`, and the manifest's
`Bundle-Version`.
