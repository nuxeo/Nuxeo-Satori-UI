# Media rights

A Nuxeo Satori business app: an app definition package
([package-pipeline.md](../../../docs/business-apps/package-pipeline.md), section 1). The `app-package` generator
scaffolded it with the files below; they are yours to change.

| File                                      | What it is                                                      |
| ----------------------------------------- | --------------------------------------------------------------- |
| `bundle/agentic-ui-config/app.json`       | The app: its id, name, version, platform range and groups       |
| `bundle/agentic-ui-config/labels/en.json` | Its labels, in English                                          |
| `bundle/OSGI-INF/media-demo-config.xml`   | The component, which contributes the app to the server          |
| `bundle/META-INF/MANIFEST.MF`             | The bundle's manifest, which names the component                |
| `package/package.xml`                     | The Marketplace package: name, version, what it depends on      |
| `package/install.xml`                     | What installing it does: it copies the bundle, and nothing else |
| `build.mjs`                               | Version 1's builder: the generator's, byte for byte             |

What each file may say is [app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md) and
[layout-v2.md](../../../docs/business-apps/layout-v2.md).

## Adding to it

Each of these generators writes its file and has the component name it. From the repository's
root:

```bash
# A record page, and an Edit form
npx nx g ./tools/satori-generators:app-layout --package=business-apps/packages/media-demo --type=<Type> --model=<content-model.json>
npx nx g ./tools/satori-generators:app-form --package=business-apps/packages/media-demo --type=<Type> --mode=edit --model=<content-model.json>
# A queue, queues/<id>.json
npx nx g ./tools/satori-generators:app-queue --package=business-apps/packages/media-demo --id=<queue> --pageProvider=<page provider>
# A button, in actions.json
npx nx g ./tools/satori-generators:app-action --package=business-apps/packages/media-demo --id=media.<name> --transition=<transition>
```

## Checking and building it

```bash
npm run app-package -- business-apps/packages/media-demo --platform <platform version>
```

It writes `dist/media-demo-<version>.zip`. `--model <file>` holds the layouts to a server's
content model; `npm run app-package:model` exports one. A version is raised in three places,
together: `package/package.xml`, `app.json`'s `packageVersion`, and the manifest's
`Bundle-Version`.
