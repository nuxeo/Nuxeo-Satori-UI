# Tutorial: build a small business app in a day

The tutorial the [development plan](development-plan.md) names in phase 3's "Done when": someone
outside the team builds a small app, from an empty package, in a day. It builds one app two ways:

- **[By hand](#part-1-by-hand),** with the generators, the package pipeline and `config:dev`;
- **[With the agent](#part-2-with-the-agent),** through the app builder skill and the Builder MCP
  server, which run the same generators and the same checks for you.

The app is a facilities work-order app for a fictional campus. It is none of the three kits
already here (Payers, brand assets, contracts), and every name in it is fictional. The finished
package is in the repository as the reference answer,
[`business-apps/packages/facilities-demo`](../../business-apps/packages/facilities-demo/README.md),
and CI checks and builds it as it does every kit there, on each pull request that touches a
package, the validator or the pipeline.

**How this was checked.** Every command below was run, in the order given, on 25 November 2026, in a
checkout of `staging/enterprise-grade-app`, on macOS with Node 24.22.1, against the local Docker
Nuxeo (2025.10.18, container `nuxeo`, port 8080, with the Satori package and the other kits
installed), signed in with its default administrator account from the environment. Every output
quoted is that run's, trimmed to the lines that matter, with npm's own `> agentic-ui@0.0.0 ...`
lines left out. Part 1 was then followed a second time from an empty package, by a script that ran
each command as written, wrote each file from this page, and held each quoted output to what the
command printed: every one matched, and the package it built is the reference answer's, byte for
byte, but for its README. Then the tools changed, after the run's feedback (the closing section):
the pipeline now refuses a label key with no text and a facet its page provider cannot answer, and
holds a package that ships a stand-in model to its own `content-model.json`. So steps 2 to 8 were
followed again from an empty package the same day, by a script that ran each command and wrote
each file and each label from this page. It took step 5's hand path: the step's refusal and its
`app-model --aggregates` command it ran first, then put the package back as it was before them.
Part 2's `validate_package` was asked again over stdio. The outputs those steps quote are that
run's, and the package it built is the reference answer's again, byte for byte but for its README,
with the same digest. Steps 1 and 9, and part 2's `preview_package`, whose outputs the change does
not touch, were not run again. On 26 November 2026 the reference answer gained two labels, the
Properties panel's headings for its two schemas (step 7), and moved to 0.1.1. Step 8's two commands
were run again on it with its version put back to the generator's 0.1.0, as a reader's package is,
and their digest is quoted; nothing else was run again. Three things were not run at all, and
each place says so: registering the MCP server with Claude Code, installing the package on a
server, and a person outside the team doing all of it. The times are estimates for a person new
to the repository, not measurements: measuring them is the plan's acceptance test, still to run.

## What you build

| Part                       | What it does                                                                                         | Step                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| A stand-in model           | Two record types, `Building` and `WorkOrder`, and the page providers the app lists them with         | [2](#step-2-scaffold-the-package-and-give-it-a-model)    |
| The Building record page   | Two cards of fields, and a related list of the building's work orders                                | [3](#step-3-a-record-page-with-cards-and-a-related-list) |
| The WorkOrder record page  | An overdue banner, status badges, a resolution card shown once completed, and the history            | [3](#step-3-a-record-page-with-cards-and-a-related-list) |
| The WorkOrder Edit form    | A field rule: a completed work order needs its completion date and its resolution                    | [4](#step-4-an-edit-form-with-a-field-rule)              |
| The open work orders queue | Open work orders, soonest due first, with Priority and Category facets                               | [5](#step-5-a-queue-with-a-facet)                        |
| A home and a menu          | Open work orders by priority for everyone, urgent ones for technicians, by category for coordinators | [6](#step-6-a-home-and-a-menu)                           |
| Labels                     | Every heading and name, in English                                                                   | [7](#step-7-labels)                                      |

The app is for two groups, `facilities-coordinators`, who sort the work, and
`facilities-technicians`, who do it.

| Step                                     | Estimate          |
| ---------------------------------------- | ----------------- |
| Before you start                         | 30 min            |
| 1. Read the content model                | 20 min            |
| 2. Scaffold the package, give it a model | 40 min            |
| 3. Record pages                          | 1 h 30            |
| 4. The Edit form and its field rule      | 30 min            |
| 5. The queue and its facets              | 1 h               |
| 6. The home and the menu                 | 40 min            |
| 7. Labels                                | 20 min            |
| 8. The pipeline's checks                 | 30 min            |
| 9. Preview in dev mode                   | 30 min            |
| 10. What a server install needs          | 20 min            |
| **By hand, in all**                      | **about 7 hours** |

## Before you start

- **Read, in this order:** [layout-v2.md](layout-v2.md), sections 1 to 7, for what a record page
  and a form may say; [app-definition-v2.md](app-definition-v2.md), sections 3, 4, 7, 9 and 10, for
  the app, queues, labels, the menu and the home; [package-pipeline.md](package-pipeline.md),
  sections 1 to 4, for the checks. You do not need to read them whole before you start: each step
  below names the section it uses.
- **Node 24,** as `.nvmrc` pins, and the dependencies, from the repository's root. `npm ci` needs
  `SATORI_GH_READONLY_TOKEN` in the environment, for the `@hylandsoftware` packages. Never run a
  bare `npm install`.

  ```bash
  node --version
  npm ci
  ```

  It answered `v24.22.1`, and `npm ci` left `package-lock.json` unchanged. Its warnings that some
  packages' install scripts are not run, `esbuild` and `nx` among them, are expected. On Node 25,
  set `NODE_OPTIONS=--no-experimental-webstorage` as well.

- **A development Nuxeo whose model you may share,** here the local Docker one, with the Satori
  package installed. Never point these tools at production, or at a server with data you may not
  share. The credentials come from the environment, and have no default: never write them into a
  file, a command's arguments or a URL.

  ```bash
  export NUXEO_USER=<administrator> NUXEO_PASS=<password>
  ```

  The local Docker Nuxeo also lets guests in: in step 9 the app opens as Anonymous until you sign
  out and log in with this account.

- **The platform version,** which the pipeline's `--platform` takes, and which every generator's
  next step writes as `--platform <platform version>`: the `version` of
  `libs/platform/package.json`, the platform's own package. Nothing else in the repository says it.

  ```bash
  node -p "require('./libs/platform/package.json').version"
  ```

  It answered `0.2.0`, which the commands below give, as CI and the MCP server's `validate_package`
  do.

- **Move the reference answer out of the way,** so that you build the package from nothing and
  can compare yours with it at the end. Git keeps the reference: step 8 compares yours with it,
  and step 10 puts it back. Commit nothing while you follow the tutorial.

  ```bash
  rm -r business-apps/packages/facilities-demo
  ```

- **Run everything from the repository's root.** The generators take paths from there.

# Part 1. By hand

## Step 1. Read the content model

Every name a package writes, a type, a property, a page provider, must exist on the server or be
registered in the platform. So read the server first. Export its content model to a file outside
the repository, here `/tmp/content-model.json`; on a machine others use too, pick a path of your
own:

```bash
npm run app-package:model -- --server http://localhost:8080/nuxeo --out /tmp/content-model.json
```

```text
/tmp/content-model.json: the content model of http://localhost:8080/nuxeo, 71 document types, 67 facets and 111 schemas.
```

The file is `{ doctypes, facets, schemas }`, as `/api/v1/config/types`, `/config/facets` and
`/config/schemas` answer them ([package-pipeline.md](package-pipeline.md), section 4). Ask it
whether the server has a work order:

```bash
node -e "const m = require('/tmp/content-model.json'); console.log(Object.keys(m.doctypes).length, 'types;', 'WorkOrder' in m.doctypes ? 'WorkOrder is there' : 'no WorkOrder')"
```

```text
71 types; no WorkOrder
```

- **On a customer's project,** your types are there, from Studio or a model package, and you skip
  the stand-in model in step 2: give the generators `--model /tmp/content-model.json`, or read the
  model live with `--modelServer http://localhost:8080/nuxeo`.
- **Here,** the server has no facilities model. The app is a demo kit, so it carries a fictional
  stand-in model, as the Payers kit does. That is the only case where a package writes types:
  otherwise the model is Studio's, never the package's.

## Step 2. Scaffold the package, and give it a model

**The package first,** with `app-package`. It writes `app.json`, the labels, the component, the
Marketplace files and the reviewed `build.mjs`:

```bash
npx nx g ./tools/satori-generators:app-package facilities-demo --owner=nuxeo --appId=facilities --title="Facilities" --vendor="Nuxeo" --groups=facilities-coordinators,facilities-technicians
```

```text
Generated business-apps/packages/facilities-demo

  App:                  facilities (Facilities), for facilities-coordinators, facilities-technicians, contributed to the app registry
  Marketplace package:  facilities-demo 0.1.0
  Nuxeo component:      nuxeo.config.facilities-demo
  Platform:             >=0.2.0 <1.0.0

The pipeline refuses a package that contributes nothing (step 5): add a record page first.
```

- **"Step 5" there is the pipeline's step,** the zip, not this tutorial's: the pipeline numbers its
  own steps 1 to 6 ([package-pipeline.md](package-pipeline.md), section 2). The generators' outputs
  here are trimmed: they also list each file they created, and the commands to run next.
- **No `--type` here.** With a model on the server, `--type=<Type> --model=...` would write the
  first record page too. A stand-in model needs the package to exist first, so the record pages
  come in step 3.
- **The app's id is its address,** `facilities`, where the shell is to open it. An id that is one
  of the platform's routes, such as `contracts` or `search`, is refused unless `--address` gives
  another ([app-definition-v2.md](app-definition-v2.md), section 3).
- **The groups are who the app is for.** On a server, the app registry lists the app only to
  people in one of them. That is not a security control: Nuxeo's permissions still decide which
  records anyone reads.

**The stand-in model,** with `app-model`: each type with its properties, then the page providers
the app lists them with. A property is `<name>`, `<name>:<type>` (`long`, `double`, `boolean`,
`date`, or a list such as `string[]`), or a string of fixed values, `<name>=<a>|<b>`.

```bash
npx nx g ./tools/satori-generators:app-model --package=business-apps/packages/facilities-demo --type=WorkOrder --prefix=wo --properties="number,building,category=Electrical|Plumbing|HVAC|Cleaning|Grounds,priority=Low|Normal|High|Urgent,status=New|Assigned|Completed|Cancelled,assignee,due:date,estimate:double,completed:date,resolution"
```

```text
  Type:           WorkOrder, schema workorder (wo:), 10 properties
  Page provider:  none
```

```bash
npx nx g ./tools/satori-generators:app-model --package=business-apps/packages/facilities-demo --type=Building --prefix=bldg --properties="code,campus,floors:long,manager,phone"
```

```text
  Type:           Building, schema building (bldg:), 5 properties
  Page provider:  none
```

A work order's `wo:building` will hold its building's id. Two page providers: a building's work
orders, given the building's id, latest due date first, for the Building page's related list; and
the open work orders, soonest due first, for the queue and the home.

```bash
npx nx g ./tools/satori-generators:app-model --package=business-apps/packages/facilities-demo --type=WorkOrder --pageProvider=facilities_building_work_orders --where="wo:building = ?" --sort=wo:due:desc --pageSize=20
```

```bash
npx nx g ./tools/satori-generators:app-model --package=business-apps/packages/facilities-demo --type=WorkOrder --pageProvider=facilities_open_work_orders --where="wo:status IN ('New', 'Assigned')" --sort=wo:due
```

Each answers `Type: WorkOrder, unchanged` and its page provider's name. The model is in a
component of its own, `bundle/OSGI-INF/facilities-demo-model.xml`, with the schemas in
`bundle/schemas/`, and `content-model.json` beside `bundle/` describes it as a server would: give
that file to the other generators until a server has the package. The pipeline uses it without
being told, since the package ships a stand-in model (step 8). Read it as you read the server's:

```bash
node -e "const m = require('./business-apps/packages/facilities-demo/content-model.json'); for (const s of m.schemas) console.log(s.name, s.prefix ?? '-', Object.keys(s.fields).join(', '))"
```

```text
common - icon, icon-expanded
dublincore dc contributors, coverage, created, creator, description, expired, format, issued, language, lastContributor, modified, nature, publisher, rights, source, subjects, title, valid
workorder wo number, building, category, priority, status, assignee, due, estimate, completed, resolution
building bldg code, campus, floors, manager, phone
```

## Step 3. A record page with cards and a related list

[layout-v2.md](layout-v2.md), sections 2, 3 and 7. A record page is a type's `view` layout: cards
of fields in the main area, each field shown through a widget.

**The Building page.** `app-layout` writes one card per schema of the type, leaving out Nuxeo's
own, and has the component contribute it:

```bash
npx nx g ./tools/satori-generators:app-layout --package=business-apps/packages/facilities-demo --type=Building --model=business-apps/packages/facilities-demo/content-model.json
```

```text
  Type:     Building, from business-apps/packages/facilities-demo/content-model.json
  Cards:    building (5)
  Left out: nothing
```

That is a start: one card of five fields in the model's order. Edit it into what a facilities
manager would want: the building in one card, its contact in another, and its work orders in a
related list across both columns. `bundle/agentic-ui-config/layouts/Building/view.layout.json`:

```json
{
  "$schema": "../../../../../../../libs/shared/app-definition/src/layout-v2.schema.json",
  "version": 2,
  "columns": 2,
  "cards": [
    {
      "id": "building",
      "labelKey": "facilities.card.building.building",
      "fields": [
        "bldg:code",
        { "field": "dc:title", "labelKey": "facilities.field.buildingName" },
        "bldg:campus",
        { "field": "bldg:floors", "widget": "number" }
      ]
    },
    {
      "id": "contact",
      "labelKey": "facilities.card.building.contact",
      "fields": [
        { "field": "bldg:manager", "widget": "user" },
        { "field": "bldg:phone", "widget": "phone" }
      ]
    },
    {
      "id": "work-orders",
      "labelKey": "facilities.card.building.workOrders",
      "span": 2,
      "related": {
        "pageProvider": "facilities_building_work_orders",
        "parameters": [{ "field": "ecm:uuid" }],
        "columns": [
          "wo:number",
          "dc:title",
          "wo:category",
          "wo:priority",
          "wo:status",
          { "field": "wo:due", "widget": "date" }
        ],
        "sort": [{ "field": "wo:due", "order": "desc" }],
        "pageSize": 10
      }
    }
  ]
}
```

- **A string field** shows the property with the widget its type picks; an object names the widget
  and its parameters. A widget must show its property's type: `number` on a `long`, `user` and
  `phone` on a string.
- **The related list** asks the page provider with the open record's id, `ecm:uuid`, for the `?`
  of `wo:building = ?`. A related list names a page provider, never a query: the server binds its
  parameters.
- **Each `labelKey` needs a text,** in the package's `labels/en.json` or in the platform's English
  catalogue, `apps/nuxeo-ui/public/i18n/en.json`. On a page, a card whose key has none shows its id
  made readable, so the pipeline refuses the key.

Check after every write, against the model:

```bash
npm run app-package -- business-apps/packages/facilities-demo --platform 0.2.0 --model business-apps/packages/facilities-demo/content-model.json
```

```text
business-apps/packages/facilities-demo/bundle/agentic-ui-config/layouts/Building/view.layout.json: cards[0].fields[1].labelKey: the label key "facilities.field.buildingName" has no text in labels/en.json, or in the platform's catalogue [unknown]
business-apps/packages/facilities-demo/bundle/agentic-ui-config/layouts/Building/view.layout.json: cards[1].labelKey: the label key "facilities.card.building.contact" has no text in labels/en.json, or in the platform's catalogue [unknown]
business-apps/packages/facilities-demo/bundle/agentic-ui-config/layouts/Building/view.layout.json: cards[2].labelKey: the label key "facilities.card.building.workOrders" has no text in labels/en.json, or in the platform's catalogue [unknown]
1 layout was held to the content model in business-apps/packages/facilities-demo/content-model.json.
3 files: 2 passed, 1 refused.
business-apps/packages/facilities-demo: step 2 refused it: the app definition has findings, listed above.
```

The generators gave a text to each key they wrote: `labels/en.json` has `facilities.app` and
`facilities.card.building.building`. The three keys written by hand have none. Add these three
entries to its `labels`, after those two; step 7 writes the final file:

```json
{
  "facilities.field.buildingName": "Name",
  "facilities.card.building.contact": "Contact",
  "facilities.card.building.workOrders": "Work orders"
}
```

The same command then passes:

```text
1 layout was held to the content model in business-apps/packages/facilities-demo/content-model.json.
3 files: 3 passed, 0 refused.
facilities-demo 0.1.0: checked, built and verified: business-apps/packages/facilities-demo/dist/facilities-demo-0.1.0.zip, sha256 a1dcf86f6e5f3061b3fa82d8e61e14721ce1e5aec543f486f1db3aa3fd1f0f0f
```

- **The digest is your files', byte for byte,** the labels file's spacing included, so until
  step 7 yours may differ. From step 8 it is the reference answer's.
- **`--platform 0.2.0`** is the platform version, from "Before you start".

**The WorkOrder page,** the same way. The related list opens a work order, so it needs a page too:

```bash
npx nx g ./tools/satori-generators:app-layout --package=business-apps/packages/facilities-demo --type=WorkOrder --model=business-apps/packages/facilities-demo/content-model.json
```

```text
  Type:     WorkOrder, from business-apps/packages/facilities-demo/content-model.json
  Cards:    workorder (10)
  Left out: nothing
```

Edit it into three cards and the history, with a banner while an open work order is past its due
date. The badges' tones are `status-badge`'s words, and the resolution card shows only once the
work order is completed. `bundle/agentic-ui-config/layouts/WorkOrder/view.layout.json`:

```json
{
  "$schema": "../../../../../../../libs/shared/app-definition/src/layout-v2.schema.json",
  "version": 2,
  "columns": 2,
  "banners": [
    {
      "id": "overdue",
      "tone": "warning",
      "labelKey": "facilities.banner.overdue",
      "visibleWhen": {
        "type": "core.every",
        "parameters": [
          {
            "type": "app.rules.fieldIn",
            "parameters": [{ "field": "wo:status" }, "New", "Assigned"]
          },
          { "type": "app.rules.datePassed", "parameters": [{ "field": "wo:due" }] }
        ]
      }
    }
  ],
  "cards": [
    {
      "id": "workorder",
      "labelKey": "facilities.card.workOrder.workorder",
      "fields": [
        "wo:number",
        { "field": "dc:title", "labelKey": "facilities.field.workOrderTitle" },
        {
          "field": "wo:building",
          "widget": "document-link",
          "parameters": { "types": ["Building"] }
        },
        "wo:category",
        {
          "field": "wo:priority",
          "widget": "status-badge",
          "parameters": {
            "tones": { "Low": "neutral", "Normal": "info", "High": "warning", "Urgent": "negative" }
          }
        },
        {
          "field": "wo:status",
          "widget": "status-badge",
          "parameters": {
            "tones": {
              "New": "info",
              "Assigned": "warning",
              "Completed": "positive",
              "Cancelled": "neutral"
            }
          }
        }
      ]
    },
    {
      "id": "schedule",
      "labelKey": "facilities.card.workOrder.schedule",
      "fields": [
        { "field": "wo:assignee", "widget": "user" },
        { "field": "wo:due", "widget": "date", "parameters": { "format": "long" } },
        { "field": "wo:estimate", "widget": "currency", "parameters": { "currency": "USD" } }
      ]
    },
    {
      "id": "resolution",
      "labelKey": "facilities.card.workOrder.resolution",
      "span": 2,
      "visibleWhen": {
        "type": "app.rules.fieldIn",
        "parameters": [{ "field": "wo:status" }, "Completed"]
      },
      "fields": [
        { "field": "wo:completed", "widget": "date", "parameters": { "format": "long" } },
        { "field": "wo:resolution", "widget": "long-text" }
      ]
    },
    {
      "id": "history",
      "labelKey": "facilities.card.workOrder.history",
      "span": 2,
      "timeline": { "pageSize": 10 }
    }
  ]
}
```

- **Rules are registered ids, with parameters,** never an expression: `app.rules.fieldIn` and
  `app.rules.datePassed`, combined with `core.every` ([layout-v2.md](layout-v2.md), section 5).
  The registered ones are `PACKAGED_REGISTRIES` in `libs/shared/app-definition`.
- **`document-link`** shows the building by its title, as a link. The stand-in model does not bind
  `wo:building` to a Building, so `app-layout` could not choose the widget for you: a real model,
  whose property a `documentResolver` binds, would have it chosen.
- **A banner or a hidden card is not a security control.** The server still returns every field to
  anyone who may read the record.

Its five new keys need a text too. `app-layout` gave the card it wrote one, "Workorder", which
step 7 renames. Add these to `labels/en.json`'s `labels`:

```json
{
  "facilities.banner.overdue": "This work order is past its due date.",
  "facilities.field.workOrderTitle": "Summary",
  "facilities.card.workOrder.schedule": "Schedule",
  "facilities.card.workOrder.resolution": "Resolution",
  "facilities.card.workOrder.history": "History"
}
```

## Step 4. An edit form with a field rule

The rule, in plain words: **a completed work order needs its completion date and its
resolution.** `required` is a form's key, never a record page's ([layout-v2.md](layout-v2.md),
section 2), so the rule goes into the Edit form. `app-form` writes it, with the fields that are
always required:

```bash
npx nx g ./tools/satori-generators:app-form --package=business-apps/packages/facilities-demo --type=WorkOrder --mode=edit --title --required=dc:title,wo:number,wo:building,wo:status --model=business-apps/packages/facilities-demo/content-model.json
```

```text
  Type:     WorkOrder, the Edit form, from business-apps/packages/facilities-demo/content-model.json
  Cards:    workorder (11)
  Required: dc:title, wo:number, wo:building, wo:status
  Left out: nothing
```

`--title` puts `dc:title` first: a form draws only the fields it lists. Then write the rule on the
two fields, with `app.rules.fieldIn`, which passes while `wo:status` is `Completed`, and give the
estimate and the resolution their widgets. `bundle/agentic-ui-config/layouts/WorkOrder/edit.layout.json`:

```json
{
  "$schema": "../../../../../../../libs/shared/app-definition/src/layout-v2.schema.json",
  "version": 2,
  "cards": [
    {
      "id": "workorder",
      "labelKey": "facilities.card.workOrder.workorder",
      "fields": [
        {
          "field": "dc:title",
          "required": true
        },
        {
          "field": "wo:number",
          "required": true
        },
        {
          "field": "wo:building",
          "required": true
        },
        "wo:category",
        "wo:priority",
        {
          "field": "wo:status",
          "required": true
        },
        "wo:assignee",
        "wo:due",
        { "field": "wo:estimate", "widget": "currency", "parameters": { "currency": "USD" } },
        {
          "field": "wo:completed",
          "required": {
            "type": "app.rules.fieldIn",
            "parameters": [{ "field": "wo:status" }, "Completed"]
          }
        },
        {
          "field": "wo:resolution",
          "widget": "long-text",
          "required": {
            "type": "app.rules.fieldIn",
            "parameters": [{ "field": "wo:status" }, "Completed"]
          }
        }
      ]
    }
  ]
}
```

- **The rule reads the values being typed,** so the form makes the two fields required as soon as
  the status is changed to `Completed`, and refuses Save until they are filled
  ([layout-v2.md](layout-v2.md), section 11). Not seen here: no server has a WorkOrder to edit.
- **The form types its inputs from the model:** the status is a text field, not a choice, because
  the stand-in's status is a string with fixed values, not a vocabulary; `wo:building` is edited as
  the stored id ([layout-v2.md](layout-v2.md), section 11, "The limits").
- **If no registered rule says what is asked, say so.** Do not invent an id: the pipeline refuses
  it (part 2 shows the refusal).

Step 3's command now holds three layouts to the model:

```text
3 layouts were held to the content model in business-apps/packages/facilities-demo/content-model.json.
5 files: 5 passed, 0 refused.
```

## Step 5. A queue with a facet

[app-definition-v2.md](app-definition-v2.md), section 4. A queue is a page provider's records,
with columns, a sort and facets. **A facet is an aggregate of the page provider's results,** and
only the search index answers aggregates: the page provider step 2 wrote reads the repository and
returns none. On a server, the queue would leave the facet out, saying so only in the browser's
console ([app-definition-v2.md](app-definition-v2.md), section 4). So the pipeline refuses a facet
on it. Tried, with the queue and its facets below written first, and the facets' keys given their
texts:

```text
3 layouts were held to the content model in business-apps/packages/facilities-demo/content-model.json.
6 files: 6 passed, 0 refused.
business-apps/packages/facilities-demo/bundle/agentic-ui-config/queues/open-work-orders.json: facets[0].aggregate: the page provider "facilities_open_work_orders", defined in OSGI-INF/facilities-demo-model.xml, has no aggregate "wo_priority_agg": it reads the repository, which answers none. A facet or a figure needs a page provider of the search index that defines the aggregate, as app-model --aggregates writes one [unknown]
business-apps/packages/facilities-demo/bundle/agentic-ui-config/queues/open-work-orders.json: facets[1].aggregate: the page provider "facilities_open_work_orders", defined in OSGI-INF/facilities-demo-model.xml, has no aggregate "wo_category_agg": it reads the repository, which answers none. A facet or a figure needs a page provider of the search index that defines the aggregate, as app-model --aggregates writes one [unknown]
business-apps/packages/facilities-demo: step 2 refused it: a facet or a figure names an aggregate its page provider does not define, listed above.
```

**So the queue's page provider is made the kind the search index answers,** the kind the platform's
`default_search` is, and the Payers kit's queues are: a `SearchServicePageProvider` with a search
document whose fields hold the buckets a person chooses. `app-model` writes it, given the
properties to group by, over the one step 2 wrote:

```bash
npx nx g ./tools/satori-generators:app-model --package=business-apps/packages/facilities-demo --type=WorkOrder --pageProvider=facilities_open_work_orders --where="wo:status IN ('New', 'Assigned')" --sort=wo:due --aggregates=wo:priority,wo:category --force
```

```text
  Type:           WorkOrder, unchanged
  Page provider:  facilities_open_work_orders, of the search index, with the aggregates wo_priority_agg, wo_category_agg
```

**The reference answer has it written by hand,** from before `app-model` could, with comments
that say what each part is for. The generator's has the same names, the aggregates
`wo_priority_agg` and `wo_category_agg` included, and differs only in its comments, the
parentheses around its condition and its search schema's namespace: with it, the queue, the home
and step 8's checks pass alike, and step 8's comparison lists the model's XML and
`workordersearch.xsd` as yours. To build the reference answer byte for byte, skip the command and
make the hand edits below: three to `bundle/OSGI-INF/facilities-demo-model.xml`, and a schema
file.

The search document's schema, a new file, `bundle/schemas/workordersearch.xsd`. Each field is named
exactly as its aggregate:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- STAND-IN, written by hand: the search document of the open work orders queue, as
     default_search's is the platform's. It is never saved. A facet's chosen buckets are sent back
     as named parameters, each named after its aggregate, such as wo_priority_agg=["Urgent"]; the
     server writes each into the field of the same name here, and the aggregate of that name reads
     its selection from it. So each field is named exactly as its aggregate is, in
     facilities-demo-model.xml. -->
<xs:schema
  targetNamespace="http://www.nuxeo.org/ecm/project/schemas/facilities-demo/workordersearch"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:nxs="http://www.nuxeo.org/ecm/project/schemas/facilities-demo/workordersearch">

  <xs:simpleType name="stringList">
    <xs:list itemType="xs:string" />
  </xs:simpleType>

  <!-- The priorities chosen in the queue's Priority facet. -->
  <xs:element name="wo_priority_agg" type="nxs:stringList" />
  <!-- The categories chosen in its Category facet. -->
  <xs:element name="wo_category_agg" type="nxs:stringList" />
</xs:schema>
```

In the model component, **register the schema,** after the `building` schema's line:

```xml
    <!-- By hand: the open work orders queue's search document, below. -->
    <schema name="workorder_search" prefix="wosearch" src="schemas/workordersearch.xsd" />
```

**Add the search document's type,** after the `Building` doctype, before its `</extension>`:

```xml
    <!-- By hand: the open work orders queue's search document, as DefaultSearch is
         default_search's. Never saved: it holds the facets the queue sends back
         (schemas/workordersearch.xsd). No folder lists it among its subtypes, so nothing offers to
         create one, and it is hidden from navigation. -->
    <doctype name="WorkOrderSearch" extends="Document">
      <facet name="HiddenInNavigation" />
      <schema name="workorder_search" />
    </doctype>
```

**Replace the generated `<coreQueryPageProvider name="facilities_open_work_orders">` element,**
whole, with:

```xml
    <!-- By hand, from the one app-model wrote: the open work orders queue, with two facets, and the
         home's figures. A facet is an aggregate of the page provider's results, which only the
         search index answers: a coreQueryPageProvider reads the repository and returns none. So
         this is SearchServicePageProvider, the class the platform's default_search is replaced
         with, as the Payers kit's queues are, with the search document WorkOrderSearch. An
         aggregate's id, its field there and the parameter the app sends back are one name.

         The index is written a moment after the repository, so the queue lags a change by about a
         second. -->
    <genericPageProvider name="facilities_open_work_orders"
        class="org.nuxeo.ecm.platform.query.nxql.SearchServicePageProvider">
      <searchDocumentType>WorkOrderSearch</searchDocumentType>
      <whereClause>
        <fixedPart>
          ecm:primaryType = 'WorkOrder' AND wo:status IN ('New', 'Assigned')
          AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0
        </fixedPart>
      </whereClause>
      <aggregates>
        <aggregate id="wo_priority_agg" type="terms" parameter="wo:priority">
          <field schema="workorder_search" name="wo_priority_agg" />
          <properties>
            <property name="size">10</property>
          </properties>
        </aggregate>
        <aggregate id="wo_category_agg" type="terms" parameter="wo:category">
          <field schema="workorder_search" name="wo_category_agg" />
          <properties>
            <property name="size">10</property>
          </properties>
        </aggregate>
      </aggregates>
      <sort column="wo:due" ascending="true" />
      <pageSize>50</pageSize>
      <maxPageSize>100</maxPageSize>
    </genericPageProvider>
```

This shape answers aggregates on the local Nuxeo: the Payers kit's `payers_unassigned_claims`, the
same class with a search document, returned its `claim_status_agg` buckets when it was read on
25 November 2026. On a customer's project, the page provider and its aggregates are Studio's, and
step 1's model, or the MCP server's `describe_page_provider` (part 2), shows which aggregates it
has.

**Then the queue,** with `app-queue`:

```bash
npx nx g ./tools/satori-generators:app-queue --package=business-apps/packages/facilities-demo --id=open-work-orders --pageProvider=facilities_open_work_orders --columns=wo:number,dc:title,wo:building,wo:priority,wo:assignee,wo:due --sort=wo:due --pageSize=50 --label="Open work orders"
```

```text
  Page provider:  facilities_open_work_orders
  Columns:        wo:number, dc:title, wo:building, wo:priority, wo:assignee, wo:due

  The app's <app> in business-apps/packages/facilities-demo/bundle/OSGI-INF/facilities-demo-config.xml now names queues/open-work-orders.json.
```

Add the facets, by the aggregates' ids, and the columns' widgets.
`bundle/agentic-ui-config/queues/open-work-orders.json`:

```json
{
  "$schema": "../../../../../../libs/shared/app-definition/src/queue.schema.json",
  "version": 2,
  "labelKey": "facilities.queue.open-work-orders",
  "pageProvider": "facilities_open_work_orders",
  "columns": [
    "wo:number",
    "dc:title",
    { "field": "wo:building", "widget": "document-link" },
    "wo:priority",
    { "field": "wo:assignee", "widget": "user" },
    { "field": "wo:due", "widget": "relative-date" }
  ],
  "sort": [
    {
      "field": "wo:due",
      "order": "asc"
    }
  ],
  "pageSize": 50,
  "facets": [
    { "aggregate": "wo_priority_agg", "labelKey": "facilities.facet.priority" },
    { "aggregate": "wo_category_agg", "labelKey": "facilities.facet.category" }
  ]
}
```

Each facet's `aggregate` is one of the page provider's `<aggregate id>`s, or the pipeline refuses
it. Their keys need a text; `app-queue` gave the queue's own name one. Add to `labels`:

```json
{
  "facilities.facet.priority": "Priority",
  "facilities.facet.category": "Category"
}
```

- **The pipeline holds a queue's columns and sort to the type its page provider lists,** when the
  package defines the page provider and its NXQL says the type, `ecm:primaryType = 'WorkOrder'` as
  `app-model` writes it, given step 2's model ([package-pipeline.md](package-pipeline.md),
  section 2). On a page provider of the server's, read them against the model yourself.
- **A header sorts on the server.** The search index maps `dc:title` as analysed text, which it
  cannot sort by, so a click on that header shows the error state, and Retry goes back to the
  file's order.

## Step 6. A home and a menu

[app-definition-v2.md](app-definition-v2.md), sections 9 and 10. Neither has a generator: write
both by hand. A home is cards of figures and links to queues, each shown by a rule, so each group
has its own. `bundle/agentic-ui-config/home.json`:

```json
{
  "$schema": "../../../../../libs/shared/app-definition/src/home.schema.json",
  "version": 2,
  "labelKey": "facilities.home.title",
  "cards": [
    {
      "id": "open",
      "labelKey": "facilities.home.open",
      "kpi": { "pageProvider": "facilities_open_work_orders", "aggregate": "wo_priority_agg" },
      "queue": "open-work-orders"
    },
    {
      "id": "urgent",
      "labelKey": "facilities.home.urgent",
      "kpi": {
        "pageProvider": "facilities_open_work_orders",
        "aggregate": "wo_priority_agg",
        "bucket": "Urgent"
      },
      "queue": "open-work-orders",
      "visibleWhen": { "type": "app.rules.inGroup", "parameters": ["facilities-technicians"] }
    },
    {
      "id": "by-category",
      "labelKey": "facilities.home.byCategory",
      "kpi": { "pageProvider": "facilities_open_work_orders", "aggregate": "wo_category_agg" },
      "visibleWhen": { "type": "app.rules.inGroup", "parameters": ["facilities-coordinators"] }
    }
  ]
}
```

- **A figure with an aggregate alone** shows the count and, under it, each bucket with its count;
  with a `bucket`, that bucket's count. All three cards read one page provider, which the home asks
  once.
- **A card with no rule is everyone's.** A person in both groups sees all three.

The menu, `bundle/agentic-ui-config/navigation.json`: the home, and the queue, which shows its own
name:

```json
{
  "$schema": "../../../../../libs/shared/app-definition/src/navigation.schema.json",
  "version": 2,
  "entries": [
    { "id": "home", "labelKey": "facilities.nav.home", "icon": "home", "page": "home" },
    { "id": "open-work-orders", "icon": "inbox", "queue": "open-work-orders" }
  ]
}
```

A figure's `aggregate` is held to its page provider as a facet's is. Add the five keys' texts to
`labels`:

```json
{
  "facilities.home.title": "Facilities",
  "facilities.home.open": "Open work orders, by priority",
  "facilities.home.urgent": "Urgent work orders",
  "facilities.home.byCategory": "Open work orders, by category",
  "facilities.nav.home": "Home"
}
```

Check it, with step 3's command. **This is the mistake everyone makes once,** and the pipeline
catches it:

```text
3 layouts were held to the content model in business-apps/packages/facilities-demo/content-model.json.
8 files: 8 passed, 0 refused.
business-apps/packages/facilities-demo: step 2 refused it: OSGI-INF/facilities-demo-config.xml does not name home.json, navigation.json in the app facilities, so the app registry would not serve them. Add a <file path="..."> for each, as the app-registry generator does.
```

A file written by hand is not yet one the component names, so the server would never serve it.
`app-registry` brings the component in step with the package's files:

```bash
npx nx g ./tools/satori-generators:app-registry --package=business-apps/packages/facilities-demo
```

```text
business-apps/packages/facilities-demo/bundle/OSGI-INF/facilities-demo-config.xml's <app> is in step with the package

  Files:  home.json, navigation.json, queues/open-work-orders.json, labels/en.json
  Now names:      home.json, navigation.json
```

## Step 7. Labels

[app-definition-v2.md](app-definition-v2.md), section 7. Every key has had a text since step 3, or
the pipeline would have refused it: it looks each `labelKey` up in `labels/en.json`, then in the
platform's English catalogue. What is left is the texts themselves. List the keys the package
names:

```bash
grep -rho '"labelKey": "[^"]*"' --include='*.json' --exclude-dir=labels business-apps/packages/facilities-demo/bundle/agentic-ui-config | sort -u
```

It lists 19 keys, `facilities.app` to `facilities.queue.open-work-orders`. Rename what the
generators guessed: `app-layout` named the WorkOrder card after its schema, "Workorder". A field
with no key shows its property's name made readable, `wo:number` as "Number"; a
`layout.field.<prefix>:<name>` key gives it another in this language. The Properties panel
beside a record page heads each schema's section the same way, `workorder` as "Workorder", until a
`layout.schema.<schema>` key, by the schema's name and not its prefix, names it
([app-definition-v2.md](app-definition-v2.md), section 7). The whole file, in the reference
answer's order, `bundle/agentic-ui-config/labels/en.json`:

```json
{
  "$schema": "../../../../../../libs/shared/app-definition/src/labels.schema.json",
  "version": 2,
  "labels": {
    "facilities.app": "Facilities",
    "facilities.home.title": "Facilities",
    "facilities.home.open": "Open work orders, by priority",
    "facilities.home.urgent": "Urgent work orders",
    "facilities.home.byCategory": "Open work orders, by category",
    "facilities.nav.home": "Home",
    "facilities.queue.open-work-orders": "Open work orders",
    "facilities.facet.priority": "Priority",
    "facilities.facet.category": "Category",
    "facilities.banner.overdue": "This work order is past its due date.",
    "facilities.card.building.building": "Building",
    "facilities.card.building.contact": "Contact",
    "facilities.card.building.workOrders": "Work orders",
    "facilities.card.workOrder.workorder": "Work order",
    "facilities.card.workOrder.schedule": "Schedule",
    "facilities.card.workOrder.resolution": "Resolution",
    "facilities.card.workOrder.history": "History",
    "facilities.field.buildingName": "Name",
    "facilities.field.workOrderTitle": "Summary",
    "layout.schema.workorder": "Work order",
    "layout.schema.building": "Building",
    "layout.field.bldg:code": "Building code",
    "layout.field.bldg:manager": "Facilities manager",
    "layout.field.wo:number": "Work order",
    "layout.field.wo:due": "Due",
    "layout.field.wo:estimate": "Estimate",
    "layout.field.wo:completed": "Completed on"
  }
}
```

## Step 8. The pipeline's checks

[package-pipeline.md](package-pipeline.md), sections 2 and 4. The pipeline checks the builder, the
app definition, the version, the build, the zip and its checksum, and stops at the first step that
fails, leaving no zip. Run it with the model, then as CI runs it, without:

```bash
npm run app-package -- business-apps/packages/facilities-demo --platform 0.2.0 --model business-apps/packages/facilities-demo/content-model.json
```

```text
3 layouts were held to the content model in business-apps/packages/facilities-demo/content-model.json.
8 files: 8 passed, 0 refused.
facilities-demo 0.1.0: checked, built and verified: business-apps/packages/facilities-demo/dist/facilities-demo-0.1.0.zip, sha256 a8b888597aeeb8daa82808346055b7f0cbbbe5fa6e7d2d0686877ba8fbf07ab6
```

```bash
npm run app-package -- business-apps/packages/facilities-demo --platform 0.2.0
```

```text
The content model is the package's own content-model.json, since the package ships a stand-in model and no --model was given.
3 layouts were held to the content model in business-apps/packages/facilities-demo/content-model.json.
8 files: 8 passed, 0 refused.
facilities-demo 0.1.0: checked, built and verified: business-apps/packages/facilities-demo/dist/facilities-demo-0.1.0.zip, sha256 a8b888597aeeb8daa82808346055b7f0cbbbe5fa6e7d2d0686877ba8fbf07ab6
```

The same zip, byte for byte. With no `--model`, the pipeline held the package to its own
`content-model.json`, as CI and `validate_package` do, because the package ships a stand-in
model. Your digest is the same as this one if your files are the reference answer's at the
generator's version, 0.1.0; compare them:

```bash
git status --short business-apps/packages/facilities-demo
```

It lists `README.md`, ` M business-apps/packages/facilities-demo/README.md`: the reference
answer's README describes the kit, and yours is the generator's. It also lists the three files that
hold the version, `bundle/agentic-ui-config/app.json`, `package/package.xml` and
`bundle/META-INF/MANIFEST.MF`: the reference answer is 0.1.1, since its two schema headings, and
yours is the generator's 0.1.0. Any other file listed is where yours differs; `git diff` shows how.

**A deliberate mistake.** Misspell a property, as anyone does: in the WorkOrder page, change
`"wo:assignee"` in the schedule card to `"wo:asignee"`. Run the pipeline as CI runs it, the second
command above, without `--model`. It is refused at step 2, the finding names the file, the place
and the reason, and no zip is left in `dist/`:

```text
The content model is the package's own content-model.json, since the package ships a stand-in model and no --model was given.
business-apps/packages/facilities-demo/bundle/agentic-ui-config/layouts/WorkOrder/view.layout.json: cards[1].fields[0].field: "wo:asignee" is not a property of the type "WorkOrder" or of its facets [unknown]
3 layouts were held to the content model in business-apps/packages/facilities-demo/content-model.json.
8 files: 7 passed, 1 refused.
business-apps/packages/facilities-demo: step 2 refused it: the app definition has findings, listed above.
```

With `--model`, the finding is the same. Put `"wo:assignee"` back, and the pipeline passes with the
digest it had.

- **On a customer's project, give it the server's model.** A package that ships no stand-in model
  is held to no model unless it is given one, and CI and `validate_package` give none: there the
  misspelt property passes, and the field shows nothing on the page. `--model` or `--model-server`
  refuses it ([package-pipeline.md](package-pipeline.md), section 4).
- **Never weaken a check to pass.** A refusal is fixed in the package.
- **What it does not check yet:** that a page provider exists, a facet on a page provider of the
  server's, a queue's or a related list's columns and sorts on a page provider of the server's, the
  properties a rule or a computation names, and whether NXQL the check of its tokens passes will
  run. Read those against the model, and the server, yourself.

## Step 9. Preview in dev mode

`config:dev` serves the package's files to the development server as a server would, into
`apps/nuxeo-ui/public/agentic-ui-config/`, which git ignores. It replaces what it served before.

```bash
C=business-apps/packages/facilities-demo/bundle/agentic-ui-config && npm run config:dev -- --layout Building/view=$C/layouts/Building/view.layout.json --layout WorkOrder/view=$C/layouts/WorkOrder/view.layout.json --layout WorkOrder/edit=$C/layouts/WorkOrder/edit.layout.json --home $C/home.json --navigation $C/navigation.json --labels en=$C/labels/en.json --queue $C/queues/open-work-orders.json
```

```text
wrote apps/nuxeo-ui/public/agentic-ui-config/bootstrap.json: defaults
wrote apps/nuxeo-ui/public/agentic-ui-config/manifest.json: defaults
wrote apps/nuxeo-ui/public/agentic-ui-config/layouts.json: Building/view, WorkOrder/view, WorkOrder/edit
wrote apps/nuxeo-ui/public/agentic-ui-config/home.json: business-apps/packages/facilities-demo/bundle/agentic-ui-config/home.json
wrote apps/nuxeo-ui/public/agentic-ui-config/labels/en.json: business-apps/packages/facilities-demo/bundle/agentic-ui-config/labels/en.json
wrote apps/nuxeo-ui/public/agentic-ui-config/queues: open-work-orders
wrote apps/nuxeo-ui/public/agentic-ui-config/navigation.json: business-apps/packages/facilities-demo/bundle/agentic-ui-config/navigation.json
no task forms: apps/nuxeo-ui/public/agentic-ui-config/tasks not served
```

Then start the development server, after that folder exists: one started before it serves nothing
under it until it is restarted. Port 4299 here, so that it does not answer for another checkout's
server on the default 4200; any free port does.

```bash
npx nx serve nuxeo-ui --port 4299
```

It is up when it prints `Local: http://localhost:4299/`. Open `http://localhost:4299/#/home`, and
**sign in before you look at anything:**

1. The local Docker Nuxeo lets guests in, so the app opens signed in as Anonymous, and nothing on
   the page says so but "AN" at the bottom of the menu. A guest sees what a guest may read, which
   is not what your account sees.
2. Open "AN" and choose Sign Out.
3. Log in with your account, the one in `NUXEO_USER`.

Signed in as the administrator, on 25 November 2026:

| Where                         | What it showed                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#/home`                      | **Drawn from the package:** the title "Facilities" and the card "Open work orders, by priority", with "Open the queue". Its figure says "Unavailable" (below) |
| The menu                      | **The package's two entries,** "Home" and "Open work orders", after the platform's own                                                                        |
| `#/queues/open-work-orders`   | **Drawn from the package,** under its name, "Open work orders"; the list says "Something went wrong. The server could not complete the request." (below)      |
| The group cards               | **Hidden,** as they should be: the administrator is in neither group                                                                                          |
| The record pages and the form | **Not seen:** they open on a record of their type, and no server has a Building or a WorkOrder                                                                |

"Unavailable" and "Something went wrong" are the server's answer, not the package's: it has no
`facilities_open_work_orders` until the package is installed. The browser's console says so:

```text
[agentic-ui-home] card "open": the page provider "facilities_open_work_orders" was not read: HTTP 500
[agentic-ui-layouts] queues/open-work-orders.json: facilities_open_work_orders not read: HTTP 500
```

- **Change a file, run `config:dev` again, reload the page.** The dev server serves what
  `config:dev` writes without a restart: under a second, as `scripts/dev-config.mjs` measured it.
- **`app.json` is not served under `config:dev`:** the shell keeps the platform's name, and "Switch
  app" is the registry's, on a server.
- **What `config:dev` serves wins over the server's registry,** for the home, the menu, the queues
  and the labels. `npm run config:dev` with no option serves the platform's defaults alone again.

## Step 10. What a server install needs

**Not run for this kit:** the local Nuxeo was read-only for this tutorial. What follows is what the
package needs, and where the steps that did run for the other kits are.

1. **The platform package,** `nuxeo-agentic-ui`, which `package.xml` depends on (2026.0.2). A server
   that has it answers `/nuxeo/agentic-ui-apps/apps.json`; the local one did, with `"apps" : [ ]`
   for the administrator, who is in no app's groups.
2. **The package built and installed:** `npm run app-package` writes
   `dist/facilities-demo-0.1.0.zip`; `nuxeoctl mp-install` installs it, and the server restarts.
   `nuxeoctl` refuses while the server runs, and in the Docker container the server is the main
   process: the Payers kit's README, "Installing it on a local Nuxeo", shows the one-off script that
   ran on this container on 23 November 2026, `nuxeo-agentic-ui` first.
3. **A search index,** for the queue and the home: `facilities_open_work_orders` is answered by it,
   as `default_search` is. The local stack has OpenSearch beside Nuxeo.
4. **The groups, and people in them.** Create `facilities-coordinators` and
   `facilities-technicians` on the server. The app registry lists the app only to their members:
   an administrator in neither sees no app.
5. **Records,** with fictional data. No folder lists `Building` or `WorkOrder` among its subtypes,
   so the Create menu does not offer them: records come from a seed script through the REST API, as
   the contracts kit's `demo/seed.mjs` writes its contracts, and a work order's `wo:building` must
   hold its building's id. This kit has no seed yet.
6. **Then check the model the server answers** against `content-model.json`, and use the server's
   from then on: `npm run app-package:model` exports it, as in step 1.
7. **Publishing to pre-production is a person's step:** a tag, `app-package/<name>/<version>`, on a
   merged commit, which CI signs and publishes. That path has never run, and the MCP server has no
   publish tool ([package-pipeline.md](package-pipeline.md), section 5). Never push the tag for
   someone else.

| Part                          | On a server, from the installed package | Under `config:dev`                    |
| ----------------------------- | --------------------------------------- | ------------------------------------- |
| The model and page providers  | Yes                                     | From the server, so not here yet      |
| The three layouts             | Yes, to everyone                        | Yes                                   |
| The home, menu, queue, labels | From the registry, to the two groups    | Yes, and they win over the registry's |
| `app.json`                    | From the registry: it lists the app     | No                                    |

Seeing an app is not a security control: Nuxeo's permissions still decide which records anyone
reads.

When you are done, put the reference answer back, and the dev server's defaults:

```bash
git checkout -- business-apps/packages/facilities-demo
npm run config:dev
```

# Part 2. With the agent

The agent does steps 1 to 9 for you: it reads the server through the Builder MCP server, runs the
same generators, writes the same hand edits, runs the same pipeline, and serves the package to the
dev server. You say what you want in plain words, and check what it did. It follows
[`.cursor/skills/app-builder/SKILL.md`](../../.cursor/skills/app-builder/SKILL.md), whose table says
what is built: everything above, and not publishing.

**What was checked, and what was not.** The MCP server's answers below are real: it was started
over stdio, as Claude Code starts it, and each tool was called with the arguments shown. The agent
that wrote the reference answer followed the skill, and its writes are part 1's commands and files.
Not run: registering the server with `claude mcp add-json`, which changes the person's own Claude
configuration, and a fresh Claude Code session taking the prompts below. Those are the plan's
"outside builder's day".

**Every write goes through the MCP server now.** The skill has the agent write each file with
`write_package_file`, run each generator with `apply_generator`, and make the steps that are each
refused alone, such as `app-package`, `app-model` and `app-layout` for a new kit, in one
`apply_package_changes` call. Each writes to the package only what passes the pipeline, and
otherwise answers the findings and changes nothing ([`tools/builder-mcp`](../../tools/builder-mcp/README.md),
"Writing a package"). The reference answer below was written before those tools, with part 1's
commands, and has not been written again through them.

## Register the MCP server, once

From the repository's root, in a shell with `NUXEO_USER` and `NUXEO_PASS` exported. The single
quotes keep the password out of the configuration: it holds the variables' names.

```bash
claude mcp add-json nuxeo-builder --scope local '{"type":"stdio","command":"node","args":["tools/builder-mcp/src/main.ts"],"env":{"NUXEO_URL":"${NUXEO_URL:-http://localhost:8080}","NUXEO_USER":"${NUXEO_USER}","NUXEO_PASS":"${NUXEO_PASS}"}}'
```

Then `claude mcp list` should list `nuxeo-builder`, and `/mcp` in Claude Code its 16 tools. For
`preview_package` to reach a dev server on port 4299, add `"DEV_SERVER_URL":"http://localhost:4299"`
to `env`; its default is `http://localhost:4200`. Start the dev server as in step 9.

## Ask, step by step

Start Claude Code in the repository, with the reference answer moved out of the way as in "Before
you start". The prompts are examples: say it your way, one step at a time, and read what the agent
answers before the next.

| You ask                                                                                                                                                                                                                                                                                            | The agent should                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Follow `.cursor/skills/app-builder/SKILL.md`. I want a small facilities work-order app, Facilities, package `facilities-demo`, app id `facilities`, for `facilities-coordinators` and `facilities-technicians`. Read the server first."                                                           | Say what is not built (publishing). Call `get_content_model` and `describe_document_type` for `WorkOrder`, find none, and stop: types are Studio's                                                         |
| "It is a demo kit: write a stand-in model with `app-model`. A WorkOrder has a number, a building (the Building's id), a category, a priority, a status, an assignee, a due date, an estimate, a completion date and a resolution; a Building has a code, a campus, floors, a manager and a phone." | Run step 2's `app-package`, without `--type`, and `app-model` for the two types                                                                                                                            |
| "Page providers: a building's work orders, latest due first, and the open ones, New or Assigned, soonest due first."                                                                                                                                                                               | Run step 2's two `app-model --pageProvider` commands                                                                                                                                                       |
| "A Building page with its details, a contact card and a list of its work orders. A WorkOrder page with the priority and status as badges, a warning when an open one is overdue, the resolution once completed, and the history."                                                                  | Run `app-layout` twice, edit the two files as in step 3, and run the pipeline with `--model`                                                                                                               |
| "In the Edit form, a completed work order needs its completion date and its resolution."                                                                                                                                                                                                           | Run `app-form`, then write `required` with `app.rules.fieldIn` on the two fields, as in step 4                                                                                                             |
| "A queue of the open work orders I can filter by priority and by category."                                                                                                                                                                                                                        | Say that a facet needs an aggregate the search index answers; write the page provider with `app-model --aggregates`, or by hand as step 5 does; run `app-queue`, add the facets and give their keys a text |
| "A home with the open work orders by priority for everyone, the urgent ones for technicians, a breakdown by category for coordinators, and a menu with the home and the queue. Then the labels."                                                                                                   | Write `home.json` and `navigation.json`, run `app-registry`, and write the labels, as in steps 6 and 7                                                                                                     |
| "Check it with the model, and show it to me."                                                                                                                                                                                                                                                      | Run step 8's command with `--model`, then `validate_package` and `preview_package`, and say what the preview cannot show                                                                                   |

**What the MCP server answered,** for the reads:

- `describe_document_type` `{ "type": "WorkOrder" }`: an error, `The server has no document type "WorkOrder".`
- `describe_page_provider` `{ "name": "facilities_open_work_orders" }`: an error,
  `The server has no page provider "facilities_open_work_orders".`
- `describe_page_provider` `{ "name": "default_search" }`: the platform's own search, with its
  search document `DefaultSearch`, its predicates, and six aggregates, `dc_nature_agg` to
  `dc_modified_agg`. That is how to see which facets a server's page provider can give a queue
  before writing one.
- `get_content_model`: `"counts": { "types": 71, "facets": 67, "schemas": 111 }`, the same model
  step 1 exported.

**What `validate_package` answered** for `{ "directory": "business-apps/packages/facilities-demo" }`:
`"passed": true`, `"asCi": true`, no finding, and the zip's digest, `4afd4153...fb61f`, step 8's
before step 7 gained the two schema headings. It
runs the pipeline as CI does, with no `--model`, so the pipeline held the package to its own
`content-model.json`, the first line of its `stdout`. With the misspelt property of step 8 it
answered `"passed": false`, `"refusedAt": { "step": 2 }`, and one finding:

```json
{
  "file": "bundle/agentic-ui-config/layouts/WorkOrder/view.layout.json",
  "place": "cards[1].fields[0].field",
  "message": "\"wo:asignee\" is not a property of the type \"WorkOrder\" or of its facets",
  "kind": "unknown"
}
```

On a customer's package, which ships no stand-in model, it is held to no model: ask the agent for
step 8's command with `--model` as well.

**What `preview_package` answered,** with the dev server on 4299: `"served": true`, the seven files
written to the dev folder, `app.json` under `notServed` ("The app registry serves it on a server,
after sign-in"), `"devServer": { "answering": true, ... }`, and the pages to open, the home and
the queue, as in step 9; sign in first, as step 9 says. It names the Edit form "the WorkOrder
record page (edit)": it is the form.

**An agent asked for an unregistered id is refused.** The field rule was written on
`wo:resolution` with `app.rules.fieldEquals`, which reads well and is not registered, as an agent
told to use it would write it. `validate_package` answered `"passed": false`,
`"refusedAt": { "step": 2 }`, and one finding:

```json
{
  "file": "bundle/agentic-ui-config/layouts/WorkOrder/edit.layout.json",
  "place": "cards[0].fields[10].required",
  "message": "the rule \"app.rules.fieldEquals\" is not registered",
  "kind": "unknown"
}
```

With `app.rules.fieldIn` back, it passed with the same digest. The skill says the same: a rule in
plain words is a registered rule, or the agent says none fits.

**Check the agent's work as you would your own:** the same `git status` against the reference
answer, the pipeline with `--model`, and the preview. The agent never installs, publishes or
writes to a server without your go-ahead, and the skill tells it to say what is left for a person.

# What the tutorial's run found

The acceptance test's feedback: where a step was slower, or more confusing, than it should be. In
the order the run met them. The run followed the tools as they were; items 1 to 5 and 9 were then
addressed, each marked **since fixed**, and the steps above follow the tools as they are now.

1. **The queue's facet is the slowest step, and the only one with no help.** A facet needs a page
   provider the search index answers, with aggregates and a search document; `app-model` writes only
   repository ones, so three hand edits to the model's XML and a schema file are needed. Nothing
   checks any of it: the pipeline does not read page providers, and a facet on a page provider with
   no aggregate passes and is left out in the browser, said only in the console. `app-model` could
   write the indexed kind, with `--aggregate`. **Since fixed:** `app-model --aggregates` writes it
   (step 5), and the pipeline refuses a facet, or a home's figure, whose page provider in the
   package's own model does not define its aggregate.
2. **CI and `validate_package` pass no content model, so a misspelt property passes both,** though
   the kit carries `content-model.json` beside it. Only the command with `--model` refuses it. The
   pipeline could read a package's own `content-model.json` when it has one. **Since fixed:** given
   no model, the pipeline holds a package that ships a stand-in model to its own
   `content-model.json`, so CI and `validate_package` refuse it (step 8). A package on a customer's
   model is still held to none unless it is given one.
3. **A demo kit's order is not the skill's first example.** `app-package --type` needs the model,
   and `app-model` needs the package, so a demo scaffolds without `--type`, then writes the model,
   then the record pages. The generator's own output says so; the skill's first example does not.
   **Since fixed:** the skill's section 2 gives a demo kit's order.
4. **Every generator says `--platform <platform version>`, and none says where it is:**
   `libs/platform/package.json`, 0.2.0. **Since fixed, in the docs:** "Before you start",
   [package-pipeline.md](package-pipeline.md), section 3, and the skill say where it is. The
   generators' own words are unchanged.
5. **No check says a label key has no text.** The pipeline passes, and the page shows an id made
   readable. The `grep` in step 7 lists the keys; the pipeline could. The generators also guess
   texts from schema names, "Workorder". **Since fixed:** the pipeline refuses a key with a text in
   neither the package's `labels/en.json` nor the platform's catalogue, by its key and its file
   (step 3). The guessed texts remain.
6. **Reading a type's fields by hand takes a `node -e` line.** The MCP server's
   `describe_document_type` reads only the server, not a stand-in model, so in a demo kit neither
   the person nor the agent has a reader for the model they are building on.
7. **`app-layout` cannot pick `document-link` for a stand-in reference,** since `app-model` binds no
   property to a type: `wo:building` was given its widget by hand, and the form edits it as an id.
8. **Dev mode shows a demo kit's shell, not its pages.** The home's figure is "Unavailable", the
   queue "Something went wrong", and the record pages cannot be opened at all, until a server has
   the package and records of its types. For a demo kit, the preview is half a preview.
9. **The local Nuxeo opens the app as Anonymous.** A person must find Sign Out behind "AN" before
   logging in; nothing on the page says the app is a guest's. **Since fixed, on this page:** "Before
   you start" and step 9 say so before the page is opened. The app itself still does not.
10. **`preview_package` still calls the Edit form "the WorkOrder record page (edit)",** as the
    contracts kit's feedback, item 7, found.
11. **No folder offers the stand-in types, and nothing writes a seed.** A server with the package
    installed has no way to create a Building or a WorkOrder but the REST API, and this kit has no
    seed script yet.
12. **Registering the MCP server changes the person's own Claude configuration,** and could not be
    checked here. Nothing in the repository shows that the registered server answers, short of
    `claude mcp list`.
13. **What went well:** each generator says what it wrote and what to run next; the refusal for a
    home written by hand names the exact fix, `app-registry`; and every finding names the file, the
    place and the reason.

**An independent follower,** an agent told to read part 1 alone, followed it from a fresh
worktree on 25 November 2026. Every output matched through step 3's first command; then its
environment refused it the first hand-written file, and it stopped there, as it was told to. What
it found is fixed above: a fixed branch name that a second follower on the same machine could not
create, the generator's "step 5" read as this page's, npm's warnings unmentioned, and a shared
`/tmp` path. So steps 3 to 10 have been followed by the tutorial's author and its script only:
the next follower, a person outside the team, is the acceptance test.
