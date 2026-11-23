# Payers Claims (demo)

The package pipeline's demo app definition
([docs/business-apps/package-pipeline.md](../../../docs/business-apps/package-pipeline.md)), with
fictional data. Phase 0's demo runs on it, and the pipeline's controls
(`scripts/app-package.selftest.mjs`) break copies of it.

| File                                                      | What it is                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `bundle/agentic-ui-config/app.json`                       | The app: its name, version, platform range and groups          |
| `bundle/agentic-ui-config/layouts/Claim/view.layout.json` | The Claim record page, in layout version 2                     |
| `bundle/agentic-ui-config/queues/unassigned-claims.json`  | A queue                                                        |
| `bundle/agentic-ui-config/actions.json`                   | An approve button: a lifecycle transition                      |
| `bundle/agentic-ui-config/labels/en.json`                 | Its labels, in English                                         |
| `bundle/OSGI-INF/payers-claims-demo-config.xml`           | The component, which contributes the layout                    |
| `package/package.xml`                                     | The Marketplace package: name, version, and what it depends on |
| `build.mjs`                                               | Version 1's builder: the generator's, byte for byte            |
| `content-model.json`                                      | A server's content model with a Claim type, for `--model`      |

- **No bootstrap fragment.** On a shared server it would rebrand everyone's app.
- **No operation button.** Decision 3 is open, so the pipeline refuses every operation.
- **One version in two places:** `package.xml`'s and `app.json`'s `packageVersion`, raised
  together.

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0
```

Held to its content model, which is as fictional as the package and is not in the zip
([package-pipeline.md](../../../docs/business-apps/package-pipeline.md), section 4):

```bash
npm run app-package -- business-apps/packages/payers-claims-demo --platform 0.2.0 \
  --model business-apps/packages/payers-claims-demo/content-model.json
```
