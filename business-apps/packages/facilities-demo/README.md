# Facilities (demo): the tutorial's reference answer

The app the [tutorial](../../../docs/business-apps/tutorial.md) builds, from an empty package, with
the generators and the package pipeline: a small facilities work-order app for a fictional campus.
Every name in it is fictional. CI checks and builds it as it does every package under
`business-apps/packages/`, on each pull request that touches a package, the validator or the
pipeline, so a change to the generators, the validator or the
pipeline that would break the tutorial breaks this kit first.

**Not installed anywhere.** It passes the pipeline, and its home, menu and queue were drawn in dev
mode on 25 November 2026; its record pages need a server with the package installed and records of
its types, which no server has ([tutorial, step 10](../../../docs/business-apps/tutorial.md#step-10-what-a-server-install-needs)).

## What is in it

| File                                                          | What it is                                                                            | Written by                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------- |
| `bundle/agentic-ui-config/app.json`                           | The app: id and address `facilities`, version 0.1.0, two groups                       | `app-package`                |
| `bundle/agentic-ui-config/layouts/Building/view.layout.json`  | The Building record page: two cards and a related list of its work orders             | `app-layout`, then by hand   |
| `bundle/agentic-ui-config/layouts/WorkOrder/view.layout.json` | The WorkOrder record page: an overdue banner, three cards and the history             | `app-layout`, then by hand   |
| `bundle/agentic-ui-config/layouts/WorkOrder/edit.layout.json` | The Edit form, with the field rule: a completed work order needs its date and how     | `app-form`, then by hand     |
| `bundle/agentic-ui-config/queues/open-work-orders.json`       | The open work orders queue, with Priority and Category facets                         | `app-queue`, then by hand    |
| `bundle/agentic-ui-config/home.json`                          | The home: open work orders by priority for everyone, one figure for each group        | By hand                      |
| `bundle/agentic-ui-config/navigation.json`                    | The menu: the home and the queue                                                      | By hand                      |
| `bundle/agentic-ui-config/labels/en.json`                     | Every label key the files name, in English                                            | The generators, then by hand |
| `bundle/OSGI-INF/facilities-demo-config.xml`                  | The component: the three layouts, and the app with the four files the registry serves | The generators               |
| `bundle/OSGI-INF/facilities-demo-model.xml`                   | **The stand-in model:** two types, a search document and two page providers           | `app-model`, then by hand    |
| `bundle/schemas/*.xsd`                                        | **The stand-in model's** schemas: `workorder`, `building` and the queue's search one  | `app-model`, and one by hand |
| `content-model.json`                                          | The stand-in model as a server would answer it, for `--model`                         | `app-model`                  |
| `package/`, `bundle/META-INF/MANIFEST.MF`, `build.mjs`        | The Marketplace package, the manifest, and version 1's builder, byte for byte         | `app-package`, `app-model`   |

- **The stand-in model** is two types with no file, so each opens as a record page: `Building`
  (`bldg:code`, `campus`, `floors`, `manager`, `phone`) and `WorkOrder` (`wo:number`, `building`,
  `category`, `priority`, `status`, `assignee`, `due`, `estimate`, `completed`, `resolution`). A
  work order's `wo:building` holds its building's id. The names are plain: on a server whose model
  already has a `Building` or a `WorkOrder`, the two would collide.
- **The queue's page provider is the one hand-written part of the model.** `app-model` writes page
  providers that read the repository, and a facet needs one that the search index answers, with
  aggregates: `facilities_open_work_orders` is a `SearchServicePageProvider` with the search
  document `WorkOrderSearch`, as the Payers kit's queues are.
- **No `actions.json`, no seed and no bootstrap fragment.** The tutorial asks for no button;
  seeding is what an install still needs; a bootstrap fragment would rebrand everyone's app on a
  shared server.

## Building it

```bash
npm run app-package -- business-apps/packages/facilities-demo --platform 0.2.0 --model business-apps/packages/facilities-demo/content-model.json
```

It writes `dist/facilities-demo-0.1.0.zip` and its checksum. Without `--model`, as CI runs it, the
same zip is built: the model only adds checks.
