# Tutorial: build a kit with the app builder skill

For a presales engineer who needs a demo kit: a stand-in model, record pages, queues, a home and a
menu, a package that the pipeline builds, a seed that writes fictional records, and a steps file
that a server run of the demo follows. The worked example is the vehicle deals and titles kit,
[`business-apps/packages/vehicle-titles-demo`](../../../business-apps/packages/vehicle-titles-demo/README.md):
this tutorial builds a smaller copy of it in a scratch folder, through the same write tools, with
the kit's type names, prefixes and page providers but an app of its own, `vehicle-deals`, and its
checklist in `vdeal:checklist` where the kit's is `vdocs:checklist`, then uses the real kit for the seed and the steps file.

The skill is [`.cursor/skills/app-builder/SKILL.md`](../../../.cursor/skills/app-builder/SKILL.md).
When a person asks an agent for a kit, the agent follows its steps and calls the Builder MCP
server's tools. Here the same tools are called from a shell, one call at a time, with
`tools/builder-mcp/src/call.ts`, so that each answer can be read.

**How this was checked.** Every command below was run on 27 November 2026, but the server steps and
the two lists of step 4, which a kit in `business-apps/packages/` joins and this scratch one does not, in a checkout of `staging/enterprise-grade-app` at `d1f315cf5`, on macOS with Node 24.22.1,
in the order given, and the outputs quoted are that run's, trimmed. The pipeline builds, the seed's controls and the steps listing ran again after the branch's merge of `3c1c4c51d`, which added the letters add-on, with the same outputs. Nothing was read from or
written to any Nuxeo server. Each step that needs one is marked **Server step**, and was not run.

## What is built, and what is not

| Step of the skill            | State, from the skill's own table                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. Read the server           | Built: the MCP server's read-only tools. A **server step**                                      |
| 2. Write the files           | Built: each write tool writes only what passes the pipeline                                     |
| 3. Check them                | Built: the pipeline's steps 1 to 6                                                              |
| 4. Preview in dev mode       | Built, on the local dev server; not `app.json` or actions. Seeing the pages is a server step    |
| 5. Publish to pre-production | **Not built in the MCP server.** A person tags a merged commit, and that tag path has never run |

The vehicle titles kit itself is installed nowhere, and its two queries over a checklist and a date
have run on no server (its README, "Not done yet"). It has **no steps file**: section 7 below writes
one as a skeleton and lists it, and does not run it.

## Before you start

- **Node 24**, as `.nvmrc` pins, and `npm ci` from the repository's root, with
  `SATORI_GH_READONLY_TOKEN` in the environment. Never a bare `npm install`. On Node 25, set
  `NODE_OPTIONS=--no-experimental-webstorage` as well.
- **The platform version,** which the pipeline's `--platform` takes:

  ```bash
  node -p "require('./libs/platform/package.json').version"
  ```

  ```text
  0.2.0
  ```

- **A scratch package root.** The write tools write a package directly inside
  `business-apps/packages/`, or inside the folders `BUILDER_PACKAGE_ROOTS` names
  ([`tools/builder-mcp/README.md`](../../../tools/builder-mcp/README.md)). This copy uses the
  vehicle kit's own type names, so it must not sit beside the real kit: the write tools and the
  release candidate refuse two kits that register the same type. Make two folders outside the
  repository, one for the package and one for the files you write:

  ```bash
  mkdir -p /tmp/vehicle-kits /tmp/vehicle-work
  ```

- **No token for the MCP server.** `call.ts` starts the server with the shell's whole environment.
  It needs no token and no Nuxeo credential to write a package, so leave them out with `env -u`, as
  every call below does: `SATORI_GH_READONLY_TOKEN`, `NUXEO_USER` and `NUXEO_PASS`, and any other
  token your shell holds.
- **Credentials for the server steps only:** `NUXEO_USER` and `NUXEO_PASS`, from the environment,
  with no default. Never write them into a file, a command's arguments or a URL.

## 1. Read the server

**Server step.** The skill starts by reading the development server: `get_content_model`,
`describe_document_type`, `list_page_providers` and `describe_page_provider`, so that every name the
package writes exists there. This run read no server: none was to be read, and for a demo kit with a
stand-in model the skill says to go on without it and say what a read would have added. Here, that
is the server's own names, which a stand-in's could shadow, and the two queries in step 2 run
read-only as searches, which nothing here has run.

The skill's rule stands: if the type the person names is not on a customer's server, **stop**.
Creating it is Studio's. A stand-in model is for a demo kit the person asked to carry one.

## 2. Write the stand-in model and the record pages

A demo kit has no model until `app-model` writes one, and the pipeline refuses a package with no
record page, so the package, its model and its first record pages go in **one**
`apply_package_changes` call: all written, or none. Write this to `/tmp/vehicle-work/01-model.json`:

```json
{
  "package": "/tmp/vehicle-kits/vehicle-deals-tutorial",
  "changes": [
    {
      "kind": "generator",
      "generator": "app-package",
      "options": {
        "owner": "nuxeo",
        "appId": "vehicle-deals",
        "title": "Vehicle deals",
        "vendor": "Nuxeo",
        "groups": "vehicle-deal-desk,vehicle-title-clerks"
      }
    },
    {
      "kind": "generator",
      "generator": "app-model",
      "options": {
        "type": "VehicleTitle",
        "prefix": "vtitle",
        "properties": "number,issuingState,vin,status=Awaiting title|Awaiting lien release|In hand|Submitted to state|Issued,lienHolder,payoffSentOn:date,openedOn:date,issuedOn:date"
      }
    },
    {
      "kind": "generator",
      "generator": "app-model",
      "options": {
        "type": "VehicleDeal",
        "prefix": "vdeal",
        "attachments": true,
        "properties": "number,buyer,vin,year,make,model,price:double,status=Working|Contracted|Funded|Delivered|Cancelled,soldOn:date,title:document,checklist:checklist"
      }
    },
    {
      "kind": "generator",
      "generator": "app-model",
      "options": {
        "type": "VehicleDeal",
        "pageProvider": "vtitles_title_sales",
        "where": "vdeal:title = ?",
        "sort": "vdeal:soldOn:desc",
        "pageSize": 20
      }
    },
    {
      "kind": "generator",
      "generator": "app-model",
      "options": {
        "type": "VehicleDeal",
        "pageProvider": "vtitles_deals_missing_documents",
        "where": "vdeal:status IN ('Contracted', 'Funded', 'Delivered') AND vdeal:checklist/*/done = 0",
        "sort": "vdeal:soldOn"
      }
    },
    {
      "kind": "generator",
      "generator": "app-model",
      "options": {
        "type": "VehicleTitle",
        "pageProvider": "vtitles_awaiting_lien_release",
        "where": "vtitle:status = 'Awaiting lien release'",
        "sort": "vtitle:payoffSentOn",
        "aggregates": "vtitle:lienHolder,vtitle:issuingState"
      }
    },
    {
      "kind": "generator",
      "generator": "app-layout",
      "options": {
        "type": "VehicleTitle",
        "model": "/tmp/vehicle-kits/vehicle-deals-tutorial/content-model.json"
      }
    },
    {
      "kind": "generator",
      "generator": "app-layout",
      "options": {
        "type": "VehicleDeal",
        "model": "/tmp/vehicle-kits/vehicle-deals-tutorial/content-model.json"
      }
    }
  ]
}
```

What each property type gives the kit:

- **`title:document`** holds another record's id, as Nuxeo's document resolver does, so
  `app-layout` shows it as a `document-link`: a deal links its title.
- **`checklist:checklist`** is the list of entries layout version 2's checklist card reads, `item`,
  `done`, `doneBy` and `doneOn`. The vehicle titles kit was built before `app-model` had this type,
  so its checklist schema, `vehicledeal_docs`, was written by hand (its README, feedback item 2);
  today the generator writes it, and the skill says never to write it by hand.
- **`attachments: true`** gives the deal Nuxeo's `files:files`, where the phone capture page files
  photos.
- **`aggregates`** writes the lien release page provider from the search index, with a terms
  aggregate per property, `vtitle_lienHolder_agg` and `vtitle_issuingState_agg`, so a queue can
  facet on them.

Then call the write tool:

```bash
env -u SATORI_GH_READONLY_TOKEN -u NUXEO_USER -u NUXEO_PASS BUILDER_PACKAGE_ROOTS=/tmp/vehicle-kits \
  node tools/builder-mcp/src/call.ts apply_package_changes - < /tmp/vehicle-work/01-model.json > /tmp/vehicle-work/01-answer.json
```

```bash
node -e "const a = require('/tmp/vehicle-work/01-answer.json'); console.log(a.written, a.changes.length, 'files'); console.log(a.validation.stdout.slice(1).join('\n'))"
```

```text
true 16 files
2 layouts were held to the content model in /tmp/vehicle-kits/vehicle-deals-tutorial/content-model.json.
4 files: 4 passed, 0 refused.
Compared with the 0 other kits in /tmp/vehicle-kits: no name of the package's is another's.
vehicle-deals-tutorial 0.1.0: checked, built and verified: <temporary>/builder-mcp-package-…/out/vehicle-deals-tutorial-0.1.0.zip, sha256 68e6f1ac…28e3f5
```

- **`written: true`** means the package now holds the changes and passes the pipeline as CI runs
  it. The answer's `generatorOutput` holds what each generator printed. Its paths say
  `business-apps/packages/…` even with another package root: they are the staging copy's.
- **"Compared with the 0 other kits"** is the price of the scratch root: nothing to clash with. In
  `business-apps/packages/` the same write compares every name with the other kits', and these
  names would clash with the vehicle titles kit's.
- **`app-layout` wrote one card per schema,** every property in the model's order, and said what it
  left out: Nuxeo's own schemas, and `files:files`, which a `file-list` field shows once you write
  it. It wrote the checklist as a `table`; step 3 makes it a checklist card.

**Two queues**, on the page providers above, in `/tmp/vehicle-work/02-queues.json`:

```json
{
  "package": "/tmp/vehicle-kits/vehicle-deals-tutorial",
  "changes": [
    {
      "kind": "generator",
      "generator": "app-queue",
      "options": {
        "id": "vehicle-deals-missing-documents",
        "pageProvider": "vtitles_deals_missing_documents",
        "columns": "vdeal:number,vdeal:buyer,vdeal:status,vdeal:soldOn",
        "sort": "vdeal:soldOn"
      }
    },
    {
      "kind": "generator",
      "generator": "app-queue",
      "options": {
        "id": "vehicle-titles-awaiting-lien-release",
        "pageProvider": "vtitles_awaiting_lien_release",
        "columns": "vtitle:number,vtitle:vin,vtitle:lienHolder,vtitle:payoffSentOn,vtitle:issuingState",
        "sort": "vtitle:payoffSentOn"
      }
    }
  ]
}
```

```bash
env -u SATORI_GH_READONLY_TOKEN -u NUXEO_USER -u NUXEO_PASS BUILDER_PACKAGE_ROOTS=/tmp/vehicle-kits \
  node tools/builder-mcp/src/call.ts apply_package_changes - < /tmp/vehicle-work/02-queues.json > /tmp/vehicle-work/02-answer.json
```

It answered `written: true`, four files: the two queues, their label keys, and the component that
now names them for the app registry.

## 3. The pages as a person would want them

The generators' pages list every property in one card. The vehicle titles kit's are written by
hand from [layout-v2.md](../layout-v2.md), through `write_package_file`. Write these six files into
`/tmp/vehicle-work/`, each the whole file.

**`deal.layout.json`, the deal's page:** a capture from a phone, a banner, badges and a currency,
the title through its link, a checklist of required documents anyone who may write the deal can
tick, the attachments and the history.

```json
{
  "$schema": "../../../../../../../libs/shared/app-definition/src/layout-v2.schema.json",
  "version": 2,
  "columns": 2,
  "capture": { "property": "files:files", "findBy": ["vdeal:number", "vdeal:vin"] },
  "banners": [
    {
      "id": "cancelled",
      "tone": "negative",
      "labelKey": "vehicle-deals.banner.cancelled",
      "visibleWhen": {
        "type": "app.rules.fieldIn",
        "parameters": [{ "field": "vdeal:status" }, "Cancelled"]
      }
    }
  ],
  "cards": [
    {
      "id": "deal",
      "labelKey": "vehicle-deals.card.deal",
      "fields": [
        "vdeal:number",
        "vdeal:buyer",
        {
          "field": "vdeal:status",
          "widget": "status-badge",
          "parameters": {
            "tones": {
              "Working": "info",
              "Contracted": "warning",
              "Funded": "positive",
              "Delivered": "positive",
              "Cancelled": "negative"
            }
          }
        },
        { "field": "vdeal:soldOn", "widget": "date" },
        { "field": "vdeal:price", "widget": "currency", "parameters": { "currency": "USD" } }
      ]
    },
    {
      "id": "vehicle",
      "labelKey": "vehicle-deals.card.vehicle",
      "fields": ["vdeal:vin", "vdeal:year", "vdeal:make", "vdeal:model"]
    },
    {
      "id": "title",
      "labelKey": "vehicle-deals.card.title",
      "fields": [
        {
          "field": "vdeal:title",
          "widget": "document-link",
          "parameters": { "types": ["VehicleTitle"] }
        },
        {
          "id": "titleStatus",
          "field": "vdeal:title",
          "widget": "document-link",
          "parameters": { "types": ["VehicleTitle"], "show": "vtitle:status" }
        },
        {
          "id": "titleLienHolder",
          "field": "vdeal:title",
          "widget": "document-link",
          "parameters": { "types": ["VehicleTitle"], "show": "vtitle:lienHolder" }
        }
      ]
    },
    {
      "id": "documents",
      "labelKey": "vehicle-deals.card.documents",
      "checklist": {
        "field": "vdeal:checklist",
        "tickable": true,
        "items": [
          { "id": "driversLicense", "labelKey": "vehicle-deals.document.driversLicense" },
          { "id": "insurance", "labelKey": "vehicle-deals.document.insurance" },
          { "id": "odometer", "labelKey": "vehicle-deals.document.odometer" },
          { "id": "deliveryReceipt", "labelKey": "vehicle-deals.document.deliveryReceipt" }
        ]
      }
    },
    {
      "id": "attachments",
      "labelKey": "vehicle-deals.card.attachments",
      "span": 2,
      "fields": [{ "field": "files:files", "widget": "file-list" }]
    },
    {
      "id": "history",
      "labelKey": "vehicle-deals.card.history",
      "span": 2,
      "timeline": { "pageSize": 10 }
    }
  ]
}
```

**`title.layout.json`, the title's page:** a banner while it waits for its lien release, the title,
the lien, and the deals that sell the vehicle, a related list given the title's own id.

```json
{
  "$schema": "../../../../../../../libs/shared/app-definition/src/layout-v2.schema.json",
  "version": 2,
  "columns": 2,
  "banners": [
    {
      "id": "awaiting-lien-release",
      "tone": "warning",
      "labelKey": "vehicle-deals.banner.awaitingLienRelease",
      "visibleWhen": {
        "type": "app.rules.fieldIn",
        "parameters": [{ "field": "vtitle:status" }, "Awaiting lien release"]
      }
    }
  ],
  "cards": [
    {
      "id": "title",
      "labelKey": "vehicle-deals.card.vehicleTitle",
      "fields": [
        "vtitle:number",
        "vtitle:issuingState",
        "vtitle:vin",
        {
          "field": "vtitle:status",
          "widget": "status-badge",
          "parameters": {
            "tones": {
              "Awaiting title": "info",
              "Awaiting lien release": "warning",
              "In hand": "info",
              "Submitted to state": "info",
              "Issued": "positive"
            }
          }
        }
      ]
    },
    {
      "id": "lien",
      "labelKey": "vehicle-deals.card.lien",
      "fields": [
        "vtitle:lienHolder",
        { "field": "vtitle:payoffSentOn", "widget": "date" },
        { "field": "vtitle:openedOn", "widget": "date" },
        { "field": "vtitle:issuedOn", "widget": "date" }
      ]
    },
    {
      "id": "sales",
      "labelKey": "vehicle-deals.card.sales",
      "span": 2,
      "related": {
        "pageProvider": "vtitles_title_sales",
        "parameters": [{ "field": "ecm:uuid" }],
        "columns": [
          "vdeal:number",
          "vdeal:buyer",
          "vdeal:status",
          { "field": "vdeal:soldOn", "widget": "date" }
        ],
        "sort": [{ "field": "vdeal:soldOn", "order": "desc" }],
        "pageSize": 10
      }
    },
    {
      "id": "history",
      "labelKey": "vehicle-deals.card.history",
      "span": 2,
      "timeline": { "pageSize": 10 }
    }
  ]
}
```

**`lien.queue.json`,** the lien release queue with its two facets, for title clerks:

```json
{
  "$schema": "../../../../../../libs/shared/app-definition/src/queue.schema.json",
  "version": 2,
  "labelKey": "vehicle-deals.queue.vehicle-titles-awaiting-lien-release",
  "pageProvider": "vtitles_awaiting_lien_release",
  "columns": [
    "vtitle:number",
    "vtitle:vin",
    "vtitle:lienHolder",
    { "field": "vtitle:payoffSentOn", "widget": "date" },
    "vtitle:issuingState"
  ],
  "sort": [{ "field": "vtitle:payoffSentOn", "order": "asc" }],
  "facets": [
    { "aggregate": "vtitle_lienHolder_agg", "labelKey": "vehicle-deals.facet.lienHolder" },
    { "aggregate": "vtitle_issuingState_agg", "labelKey": "vehicle-deals.facet.issuingState" }
  ],
  "visibleWhen": { "type": "app.rules.inGroup", "parameters": ["vehicle-title-clerks"] }
}
```

**`home.json` and `navigation.json`,** which have no generator:

```json
{
  "$schema": "../../../../../libs/shared/app-definition/src/home.schema.json",
  "version": 2,
  "labelKey": "vehicle-deals.home.title",
  "cards": [
    {
      "id": "missing-documents",
      "labelKey": "vehicle-deals.home.missingDocuments",
      "kpi": { "pageProvider": "vtitles_deals_missing_documents" },
      "queue": "vehicle-deals-missing-documents"
    },
    {
      "id": "lien-release",
      "labelKey": "vehicle-deals.home.lienRelease",
      "kpi": {
        "pageProvider": "vtitles_awaiting_lien_release",
        "aggregate": "vtitle_lienHolder_agg"
      },
      "queue": "vehicle-titles-awaiting-lien-release",
      "visibleWhen": { "type": "app.rules.inGroup", "parameters": ["vehicle-title-clerks"] }
    }
  ]
}
```

```json
{
  "$schema": "../../../../../libs/shared/app-definition/src/navigation.schema.json",
  "version": 2,
  "entries": [
    { "id": "home", "labelKey": "vehicle-deals.nav.home", "icon": "home", "page": "home" },
    {
      "id": "vehicle-deals-missing-documents",
      "icon": "inbox",
      "queue": "vehicle-deals-missing-documents"
    },
    {
      "id": "vehicle-titles-awaiting-lien-release",
      "icon": "list",
      "queue": "vehicle-titles-awaiting-lien-release",
      "visibleWhen": { "type": "app.rules.inGroup", "parameters": ["vehicle-title-clerks"] }
    }
  ]
}
```

**`en.json`,** a text for every label key the files name, and each schema's Properties heading:

```json
{
  "$schema": "../../../../../../libs/shared/app-definition/src/labels.schema.json",
  "version": 2,
  "labels": {
    "vehicle-deals.app": "Vehicle deals",
    "layout.schema.vehicletitle": "Vehicle title",
    "layout.schema.vehicledeal": "Vehicle deal",
    "vehicle-deals.queue.vehicle-deals-missing-documents": "Deals missing documents",
    "vehicle-deals.queue.vehicle-titles-awaiting-lien-release": "Titles awaiting lien release",
    "vehicle-deals.banner.cancelled": "This deal was cancelled.",
    "vehicle-deals.banner.awaitingLienRelease": "This title waits for its lien release.",
    "vehicle-deals.card.deal": "Deal",
    "vehicle-deals.card.vehicle": "Vehicle",
    "vehicle-deals.card.title": "Title",
    "vehicle-deals.card.documents": "Required documents",
    "vehicle-deals.card.attachments": "Documents and photos",
    "vehicle-deals.card.history": "History",
    "vehicle-deals.card.vehicleTitle": "Title",
    "vehicle-deals.card.lien": "Lien",
    "vehicle-deals.card.sales": "Deals that sell this vehicle",
    "vehicle-deals.document.driversLicense": "Buyer's driver's license",
    "vehicle-deals.document.insurance": "Proof of insurance",
    "vehicle-deals.document.odometer": "Odometer disclosure statement",
    "vehicle-deals.document.deliveryReceipt": "Signed delivery receipt",
    "vehicle-deals.facet.lienHolder": "Lien holder",
    "vehicle-deals.facet.issuingState": "State",
    "vehicle-deals.home.title": "Vehicle deals",
    "vehicle-deals.home.missingDocuments": "Deals missing documents",
    "vehicle-deals.home.lienRelease": "Titles awaiting lien release, by lien holder",
    "vehicle-deals.nav.home": "Home"
  }
}
```

A write tool takes each file's content as a string, so build the arguments from the files: the six
writes and the `app-registry` that has the app name the new home and menu, in one call, the labels
first. The command also writes `04-misspelt.json`: the deal page with its checklist on a property
the type does not have, on purpose, for `write_package_file`.

```bash
node -e "
const fs = require('fs');
const at = (file) => fs.readFileSync('/tmp/vehicle-work/' + file, 'utf8');
const c = 'bundle/agentic-ui-config/';
const write = (path, file) => ({ kind: 'write', path: c + path, content: at(file) });
fs.writeFileSync('/tmp/vehicle-work/03-pages.json', JSON.stringify({
  package: '/tmp/vehicle-kits/vehicle-deals-tutorial',
  changes: [
    write('labels/en.json', 'en.json'),
    write('layouts/VehicleDeal/view.layout.json', 'deal.layout.json'),
    write('layouts/VehicleTitle/view.layout.json', 'title.layout.json'),
    write('queues/vehicle-titles-awaiting-lien-release.json', 'lien.queue.json'),
    write('home.json', 'home.json'),
    write('navigation.json', 'navigation.json'),
    { kind: 'generator', generator: 'app-registry' },
  ],
}));
fs.writeFileSync('/tmp/vehicle-work/04-misspelt.json', JSON.stringify({
  package: '/tmp/vehicle-kits/vehicle-deals-tutorial',
  path: c + 'layouts/VehicleDeal/view.layout.json',
  content: at('deal.layout.json').replace('\"vdeal:checklist\"', '\"vdeal:checklists\"'),
}));
"
```

```bash
env -u SATORI_GH_READONLY_TOKEN -u NUXEO_USER -u NUXEO_PASS BUILDER_PACKAGE_ROOTS=/tmp/vehicle-kits \
  node tools/builder-mcp/src/call.ts apply_package_changes - < /tmp/vehicle-work/03-pages.json > /tmp/vehicle-work/03-answer.json
```

It answered `written: true`, seven files, `8 files: 8 passed, 0 refused`, and `app-registry` said
"Now names: home.json, navigation.json". **Then the misspelt page,** which the write tool must
refuse and leave the package as it was:

```bash
env -u SATORI_GH_READONLY_TOKEN -u NUXEO_USER -u NUXEO_PASS BUILDER_PACKAGE_ROOTS=/tmp/vehicle-kits \
  node tools/builder-mcp/src/call.ts write_package_file - < /tmp/vehicle-work/04-misspelt.json > /tmp/vehicle-work/04-answer.json
```

```bash
node -e "const a = require('/tmp/vehicle-work/04-answer.json'); console.log(a.written, a.validation.refusedAt, a.validation.findings)"
```

```text
false { step: 2, reason: 'the app definition has findings, listed above.' } [
  {
    file: 'bundle/agentic-ui-config/layouts/VehicleDeal/view.layout.json',
    place: 'cards[3].checklist.field',
    message: '"vdeal:checklists" is not a property of the type "VehicleDeal" or of its facets',
    kind: 'unknown'
  }
]
```

The deal page's SHA-256 was the same before and after the refused write. Read every refusal this
way: the file, the place and the reason. Fix the file; never rename an id to something else
unregistered, and never write the file another way to get a pass.

## 4. Check it, and what the checks do not see

```bash
npm run app-package -- /tmp/vehicle-kits/vehicle-deals-tutorial --platform 0.2.0
```

```text
The content model is the package's own content-model.json, since the package ships a stand-in model and no --model was given.
2 layouts were held to the content model in /tmp/vehicle-kits/vehicle-deals-tutorial/content-model.json.
8 files: 8 passed, 0 refused.
vehicle-deals-tutorial 0.1.0: checked, built and verified: /tmp/vehicle-kits/vehicle-deals-tutorial/dist/vehicle-deals-tutorial-0.1.0.zip, sha256 0226b14f…14f555
```

The real kit builds the same way, from the repository:

```bash
npm run app-package -- business-apps/packages/vehicle-titles-demo --platform 0.2.0
```

```text
2 layouts were held to the content model in business-apps/packages/vehicle-titles-demo/content-model.json.
9 files: 9 passed, 0 refused.
Compared with the 10 other kits in business-apps/packages: no name of the package's is another's.
vehicle-titles-demo 0.1.0: checked, built and verified: business-apps/packages/vehicle-titles-demo/dist/vehicle-titles-demo-0.1.0.zip, sha256 c451afe3…0e168
```

That is the digest its README records. **What the pipeline does not check,** from the skill's step 3
and the kit's feedback items 7 and 8: a page provider's NXQL is checked for what Nuxeo's grammar has
no place for, not run, so `vdeal:checklist/*/done = 0` and the vehicle kit's `NOW('-P31D')` have run
on no server; and the properties a rule or a query names are not held to the model. Check those by
hand, then on the server.

**For a real kit in `business-apps/packages/`, two lists outside its folder** (the skill, step 3):
`npm run app-definition:server-validator` rebuilds the server validator's parity corpus, and the kit
gets its rows in [administrator-guide.md](../administrator-guide.md), section 1's table and the
app registry's groups. `kit-lists.spec.ts` fails a kit missing from either. Not run here: the
scratch kit joins neither.

## 5. Preview it

`preview_package` validates a package and serves it to the dev server through `config:dev`. It reads
packages inside the repository only: given the scratch kit, it answered
`directory: /tmp/vehicle-kits/vehicle-deals-tutorial is outside the repository, and is not read.`
Given the real kit, with no dev server running:

```bash
env -u SATORI_GH_READONLY_TOKEN -u NUXEO_USER -u NUXEO_PASS node tools/builder-mcp/src/call.ts preview_package '{ "package": "business-apps/packages/vehicle-titles-demo" }'
```

It answered `served: true`, the home, the menu, the three queues, the labels and the two layouts
written into the gitignored `apps/nuxeo-ui/public/agentic-ui-config/`; `app.json` not served, "The
app registry serves it on a server, after sign-in"; and `devServer.answering: false`, "Nothing
answered at http://localhost:4200". Each preview replaces the last, so serve the platform's defaults
again when you are done:

```bash
npm run config:dev
```

**Server step:** start `npx nx serve nuxeo-ui`, sign in with your own account on the Nuxeo the dev
server proxies to, and open `#/home` and the queues. A server without the kit has none of its page
providers, so its figures say "Unavailable" and its queues their error state (the kit's README,
step 4). Its record pages need records of its types, which only an install and the seed give.

## 6. The seed

A kit's `demo/seed.mjs` is code, so the write tools refuse it: a person, or another agent, writes
it. The vehicle kit's writes eight titles and eight deals, creates no user and no group, is safe to
run twice, and checks its five page providers against what it wrote (its README, "Seeding it").
Its controls run it against a stand-in for the REST API, and prove the script, not a server:

```bash
node business-apps/packages/vehicle-titles-demo/demo/seed.selftest.mjs
```

```text
47 of 47 controls passed.
```

Without credentials it stops before it asks anything of a server:

```bash
env -u NUXEO_USER -u NUXEO_PASS node business-apps/packages/vehicle-titles-demo/demo/seed.mjs
```

```text
NUXEO_USER and NUXEO_PASS must both be set, and neither has a default. Export them first:
  export NUXEO_USER=<user> NUXEO_PASS=<password>
```

It exits 2. **Server step:** with the kit installed (its README, "Installing it on a local Nuxeo",
not run), `NUXEO_USER` and `NUXEO_PASS` exported for an administrator, run the seed itself. Then the
two queries nothing has run, read-only, as searches.

## 7. The steps file

A kit's demo, as a server run follows it, is a beta harness steps file under
`scripts/beta-harness/steps/` that names the kit's folder and declares `serverRun`: the kit, the
seeds to run first, who `NUXEO_USER` must be, who else it signs in as, and what else it needs
([package-pipeline.md](../package-pipeline.md), section 11, "The demo steps, listed"). The release
candidate's stage 4 lists each one, and **refuses** one that names a kit and declares no
`serverRun`. On 27 November 2026 the kits with one were brand assets, controlled documents, media,
onboarding and Payers; **the vehicle titles kit has none.**

A skeleton for it, written outside the repository to `/tmp/vehicle-steps/vehicle-titles-queues.mjs`,
with its checks left out (the template, `scripts/beta-harness/steps/_template.mjs`, says what a
check must assert):

```js
/**
 * The vehicle titles kit's queues, on a server with the kit installed and seeded. A skeleton for
 * the tutorial, listed by the release candidate's stage 4 and not run: its checks are left out.
 *
 *   NUXEO_USER=<a title clerk> NUXEO_PASS=<password> npm run beta:evidence -- vehicle-titles-queues
 */
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'vehicle-titles-demo');
const TITLE_CLERK = "the run's own user, in vehicle-title-clerks";

export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: { users: [], who: TITLE_CLERK },
  signsInAs: [],
  needs: [
    'the kit 0.1.0 or later installed, and seeded',
    "the dev server, serving the kit's pages and labels, or none of its labels",
  ],
};

export default async function run(page, h) {
  await h.step('Set up: a title clerk, and the seeded titles');
  await h.login();
  await h.step('Titles awaiting lien release: TTL-6003, then TTL-6004, with two facets');
  await h.goTo('/#/queues/vehicle-titles-awaiting-lien-release');
  await h.step('Deals missing documents: VD-5002, VD-5004 and VD-5008, oldest sale first');
  await h.goTo('/#/queues/vehicle-deals-missing-documents');
}
```

List it as stage 4 does, with its own function, without running it:

```bash
node --input-type=module -e "
import { demoSteps } from './scripts/release-candidate-demo.mjs';
const kit = { directory: process.cwd() + '/business-apps/packages/vehicle-titles-demo', name: 'vehicle-titles-demo', version: '0.1.0' };
const { problems, listing } = await demoSteps({ repo: process.cwd(), stepsDir: process.argv[1], kits: [kit] });
console.log(problems, listing[0].files.map((each) => each.steps));
" /tmp/vehicle-steps
```

```text
[] [
  [
    'Set up: a title clerk, and the seeded titles',
    'Titles awaiting lien release: TTL-6003, then TTL-6004, with two facets',
    'Deals missing documents: VD-5002, VD-5004 and VD-5008, oldest sale first'
  ]
]
```

With `export` taken off `serverRun`, the same command answers the refusal stage 4 would stop on:
"names the kit vehicle-titles-demo and exports no serverRun". The records the steps name are the
seed's (its README, "Seeding it").

**Server step:** a real steps file has checks after each step, as
[`media-delivery.mjs`](../../../scripts/beta-harness/steps/media-delivery.mjs) and
[`onboarding-holds.mjs`](../../../scripts/beta-harness/steps/onboarding-holds.mjs) do. Moved into
`scripts/beta-harness/steps/`, it runs with `npm run beta:evidence -- vehicle-titles-queues`, as a
title clerk, on a server with the kit installed and seeded. None of that was done.

## 8. Publish: a person's step

Not built in the MCP server, and never run. The person raises the version in `package.xml`,
`app.json`'s `packageVersion` and the manifest's `Bundle-Version` together, the pull request merges,
and they tag the merged commit `app-package/<name>/<version>`; `app-packages.yml` then builds, signs
and publishes it to Marketplace preprod. No such tag has been pushed. Never push one yourself. How
a signed package is checked is the next tutorial's,
[sign and verify a package](sign-and-verify-a-package.md).

## Cleaning up

Everything this tutorial wrote is outside the repository, but the dev server's configuration, which
`npm run config:dev` set back, and the real kit's `dist/`, which git ignores. Remove
`/tmp/vehicle-kits`, `/tmp/vehicle-work` and `/tmp/vehicle-steps` when you are done.
