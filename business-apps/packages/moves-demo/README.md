# Moves and damage claims (demo)

One of phase 8's kits for case management: moves, and the damage claims filed on them
([development plan](../../../docs/business-apps/development-plan.md), phase 8, "Builds"). It was
built the way phase 3 says kits are built, as the [contracts kit](../contracts-demo/README.md) was:
an agent took the app builder skill's steps
([`.cursor/skills/app-builder/SKILL.md`](../../../.cursor/skills/app-builder/SKILL.md)) in order,
with the generators, the package pipeline and the Builder MCP server, and wrote **every package
file through the server's write tools**, which commit a change only when the pipeline passes it.
Every name in it is fictional. The log of each step, its result and each departure is
[below](#how-it-was-built-the-log).

## The short version

- **A Move record page:** the customer, the origin and destination, the dates, the crew, the
  state, the declared value, and two related lists: its inventory, each item with its declared
  value, and its damage claims.
- **A Damage Claim record page:** the move it belongs to, as a `document-link`; the items claimed,
  each a `document-link` to its inventory item; the amounts, the state, the dates, and the claim's
  **attachments**, `files:files`, which is where the driver's photo of demo step 5 goes (below).
- **No banner for a claim filed late.** The request was a banner when a claim is filed more than N
  days after delivery, with a registered rule. **No registered rule says that:** every date rule
  compares one date with today, and a rule cannot read a computation. So there is no banner, and
  no Angular code: the claim page shows the days from delivery to filing instead, as a computed
  field (`core.dateDiff`), and the gap is a follow-up ([below](#phase-8-feedback-where-the-tools-fell-short), item 2).
- **The claim's Edit form,** with the rule asked for in plain words: "a denial reason is required
  when the state is Denied", as `app.rules.fieldIn`, and three more of the same kind.
- **Two queues:** open claims, with facets on state and on move; and the moves this week.
- **A home, a menu and labels.** Open claims by state for everyone; the moves this week for move
  coordinators; the claims waiting for review for claims adjusters.
- **An `app.json` that names its own groups,** `move-coordinators` and `move-claims-adjusters`,
  and a component that contributes the app to the app registry. Its id and address are `moves`,
  which is not a platform route (`PLATFORM_ROUTES` in `libs/shared/app-definition`).
- **A stand-in model, in its own component:** `Move`, `MoveItem` and `DamageClaim`, their schemas,
  a search document and five page providers, written by `app-model`. Fictional, and replaced whole
  when a real one comes.
- **A seed script,** with its controls, writing eight fictional moves, eighteen inventory items and
  five claims. It creates no user and no group.
- **Not installed anywhere.** The package passes the pipeline; installing it and seeding it are
  the orchestrator's ([below](#installing-it-on-a-local-nuxeo)).

## What is in it

| File                                                            | What it is                                                                               | Written by                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `bundle/agentic-ui-config/app.json`                             | The app: id and address `moves`, version 0.1.0, two groups                               | `app-package`                                                |
| `bundle/agentic-ui-config/layouts/Move/view.layout.json`        | The Move record page: two banners, four cards, the inventory, the claims and the history | `app-layout`, then `write_package_file`                      |
| `bundle/agentic-ui-config/layouts/MoveItem/view.layout.json`    | An inventory item's page: the item, its move, and the claims that name it                | `app-layout`, then `write_package_file`                      |
| `bundle/agentic-ui-config/layouts/DamageClaim/view.layout.json` | The Damage Claim record page: a banner, five cards, the attachments and the history      | `app-layout`, then `write_package_file`                      |
| `bundle/agentic-ui-config/layouts/DamageClaim/edit.layout.json` | The claim's Edit form, with the denial reason's rule and three more                      | `app-form`, then `write_package_file`                        |
| `bundle/agentic-ui-config/queues/open-claims.json`              | Open claims, oldest filed first, with State and Move facets                              | `app-queue`, then `write_package_file`                       |
| `bundle/agentic-ui-config/queues/moves-this-week.json`          | Moves loading or delivering from today to seven days ahead                               | `app-queue`, then `write_package_file`                       |
| `bundle/agentic-ui-config/home.json`, `navigation.json`         | The home's three figures, and the menu: the home and the two queues                      | `write_package_file`                                         |
| `bundle/agentic-ui-config/labels/en.json`                       | Every label key the files name, in English                                               | The generators, then `write_package_file`                    |
| `bundle/OSGI-INF/moves-demo-config.xml`                         | The component: the four layouts, and the app with the five files the registry serves     | The generators                                               |
| `bundle/OSGI-INF/moves-demo-model.xml`, `bundle/schemas/*.xsd`  | **The stand-in model:** three types, a search document, five page providers              | `app-model`                                                  |
| `content-model.json`                                            | The stand-in model as a server would answer it, which the pipeline holds the kit to      | `app-model`                                                  |
| `package/`, `bundle/META-INF/MANIFEST.MF`, `build.mjs`          | The Marketplace package, the manifest, and version 1's builder, byte for byte            | `app-package`, `app-model`                                   |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/seed.selftest.mjs`      | The seed script, its fictional records, and its controls. Not packaged                   | By hand: the write tools write no code                       |
| `README.md`                                                     | This file                                                                                | `app-package`, then by hand: the write tools write no README |

- **No hand edit to a package file.** Every file under `bundle/`, `package/`, `build.mjs` and
  `content-model.json` was written by `apply_generator`, `write_package_file` or
  `apply_package_changes`, each of which answered `written: true`. Nothing in the model was
  written by hand, unlike the facilities and contracts kits' models.
- **No `actions.json`.** None was asked for, and moving a claim through its states is a property
  here, not a lifecycle (below).
- **One version in three places:** 0.1.0, in `package.xml`, `app.json`'s `packageVersion` and the
  manifest's `Bundle-Version`. No `upgrade-notes.json`: there is no version before it.

## The stand-in model

The local Nuxeo has no moves model, and none was given, so the package carries a fictional one in
a component of its own, `moves-demo-model.xml`, as the Payers kit does.

| Type          | Schema (prefix)         | What it holds                                                                                                                                                                                                      |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Move`        | `move` (`move`)         | `number`, `customer`, `customerPhone`, `customerEmail`, `origin`, `destination`, `loadDate`, `deliveryDate`, `deliveredOn`, `state`, `coordinator`, `crewLead`, `crew` (a list), `truck`, `declaredValue`, `notes` |
| `MoveItem`    | `moveitem` (`moveitem`) | `move` (its move's id), `tag`, `room`, `condition` (at origin), `declaredValue`. Its title is what it is                                                                                                           |
| `DamageClaim` | `damageclaim` (`dmg`)   | `number`, `move` (its move's id), `moveNumber`, `items` (its items' ids), `deliveredOn`, `filedOn`, `amountClaimed`, `amountApproved`, `state`, `adjuster`, `details`, `decidedOn`, `denialReason`                 |

- **`DamageClaim` also has Nuxeo's `files` schema,** `files:files`, its attachments, as a `File`
  has them. `app-model` could not give a stand-in type one, so this pull request adds
  `--attachments` to it (item 1 below). The type still opens as a record page: only the `file` and
  `note` schemas keep a record's own view (`OWN_VIEW_SCHEMAS` in `libs/shared/document-layouts`).
- **States are properties,** `move:state` (`Booked`, `Packed`, `In transit`, `Delivered`,
  `Cancelled`) and `dmg:state` (`Filed`, `In review`, `Approved`, `Denied`, `Paid`), stored as
  those words, so that the pages show them as they are and the form's rule names `Denied` as the
  request did. The types have the platform's default lifecycle, which nothing here reads.
- **The inventory is a type of its own,** listed on the move's page, not a table on the move:
  `app-model` writes no complex property (item 6 below). So each item has a page, and a claim
  names its items as `document-link`s.
- **A claim carries two copies of its move's values:** `dmg:deliveredOn`, which the days to filing
  are computed from, since a record page cannot read a linked record's property yet
  ([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 12, a proposal); and
  `dmg:moveNumber`, which the Move facet groups by, since a facet on `dmg:move` would show ids
  (item 4 below). The seed writes both from the move.
- **Not folders,** so each opens as a record page. No folder lists the types among its subtypes,
  so the Create menu does not offer them: the seed writes the records.
- **The names are plain:** `Move`, `MoveItem`, `DamageClaim`. The server already has `Claim` and
  the prefix `claim`, the Payers kit's, which is why the claim is `DamageClaim` with `dmg:`.

| Page provider       | Given        | Returns                                                                                                         | Reads            |
| ------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- | ---------------- |
| `moves_move_items`  | A move's id  | Its inventory, by tag                                                                                           | The repository   |
| `moves_move_claims` | A move's id  | Its claims, latest filed first                                                                                  | The repository   |
| `moves_item_claims` | An item's id | The claims that name it (`dmg:items/* = ?`), latest filed first                                                 | The repository   |
| `moves_open_claims` | Nothing      | Claims `Filed` or `In review`, oldest filed first, with the aggregates `dmg_state_agg` and `dmg_moveNumber_agg` | The search index |
| `moves_this_week`   | Nothing      | Moves not cancelled that load or deliver from `NOW('-P1D')` to `NOW('P7D')`, by load date                       | The repository   |

- **"This week" is the seven days from today,** not the calendar week: NXQL's `NOW()` takes an
  offset from now, not the start of a week. A day stored as midnight is in it from that day to
  seven days ahead.
- **`NOW()` in a `BETWEEN` is a syntax error** on this Nuxeo: `BETWEEN NOW('-P1D') AND NOW('P7D')`
  answered "Invalid token <NOW>", so the condition is written with `>=` and `<=`, which answered 200. Both were run read-only with stock properties in place of `move:` ones.
- **The open claims lag a write by about a second:** only the search index answers aggregates,
  which the facets and the home's figures need.

## Where the driver's photo goes

Phase 8's demo step 5 has a driver photograph damaged goods on a phone, and the photo filed on
the claim of the move. **The phone capture app is not built** (phase 8, "Builds"). This kit
leaves the place for the photo: the claim's attachments, `files:files`.

- **On the claim page,** the Attachments card lists them, with `file-list`, which shows each
  file's name until it has its lookup (layout-v2.md, section 11). The document page's own
  Attachments panel, beside the record page, uploads one for anyone who may write the claim.
- **What the capture app would do** is add a file to `files:files` on the claim it is given, as
  that panel does. Nothing here calls it, and nothing here has been tried with a photo: no server
  has the package.
- **The seed never writes `files:files`,** so a photo filed on a claim stays through a second run.

## How it was built: the log

Run on 26 November 2026, from 05:25 to 07:35 IST, in a worktree of
`staging/enterprise-grade-app` at `749cbd660`, on Node 24.22.1, against the local Docker Nuxeo
(container `nuxeo`, port 8080, which has the Satori package and the Payers and contracts kits
installed), signed in with its default administrator account from the environment. **Nothing was
written to that server:** every request was a `GET`. The agent spoke to the Builder MCP server
over stdio, as Claude Code does once the server is registered, through a small client of its own
outside the repository, as the contracts kit's run did: registering the server with
`claude mcp add-json` changes the person's own Claude configuration, which was not asked for. The
times are the agent's, from the timestamps of its commands.

### Step 0. Before you start (05:25, 2 minutes)

| What                               | Result                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `npm ci`, Node 24.22.1             | Passed in 76 seconds. `package-lock.json`'s SHA-256 the same before and after  |
| `NUXEO_USER`, `NUXEO_PASS`         | Exported in each shell only; never written to a file, a commit, a URL or a log |
| A server whose model may be shared | The local Docker Nuxeo, which holds fictional records only                     |
| The platform version               | `0.2.0`, from `libs/platform/package.json`                                     |

Reading the plan, the skill, the contracts kit's README and the three documents took about 17
minutes more.

### Step 1. Read the server (05:44, 6 minutes)

| Asked                                        | Answer                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_content_model`                          | 71 types, 67 facets, 111 schemas. No move type, no claim type but the Payers kit's `Claim`                                                         |
| `describe_document_type` `Move`              | Refused: "The server has no document type "Move""                                                                                                  |
| `describe_document_type` `DamageClaim`       | Refused, with "Close names: Claim": the Payers kit's, whose prefix is `claim`                                                                      |
| `describe_schema` `files`                    | `files:files`, `complex[]` of `{ file: blob }`, used by `File`, `Note`, the Payers kit's `ClaimDocument`                                           |
| `list_page_providers`, `move` and `claim`    | 110 page providers; none for moves; six for the Payers kit's claims                                                                                |
| `describe_page_provider` `moves_open_claims` | Refused: the server has no such page provider                                                                                                      |
| `list_vocabularies`, `list_workflows`        | The stock vocabularies and review workflows, the Payers kit's decision vocabulary and claim review: none for moves                                 |
| `npm run app-package:model`, to `tmp/`       | 71 types, 67 facets, 111 schemas, in the checkout's `tmp/`, which git ignores                                                                      |
| Read-only NXQL, with stock properties        | `>=`/`<=` with `NOW('-P1D')` and `NOW('P7D')`, `dc:subjects/* = 'x'` and `IN ('Filed', 'In review')` answered 200; `BETWEEN NOW(...)` answered 400 |

**The skill says to stop here:** the types do not exist, and creating them is Studio's. The
request asked for a stand-in model, so the kit carries one, written by `app-model`.

**Then one change outside the kit, before step 2.** The claim needs its attachments, and
`app-model` writes a type with `common`, `dublincore` and its own schema only. The write tools
refuse a model component written any other way, and the skill says never to write one by hand. So
the claim could not have a place for the photo, which the request asked for: kit-blocking. The fix
is small, and in its own commit: `app-model --attachments` gives a new type Nuxeo's `files` schema
too, in the component and in `content-model.json`; `--force` keeps it; asking for it on a type
written without it is refused. Its spec has two tests more, and a third refusal, and was seen
failing with the content model's `files` entry removed. The skill says so in its `app-model`
bullet, mirrored. 6 minutes.

### Step 2. Write the files, through the write tools only (05:55, 5 minutes)

Three writes, each answering `written: true`, and two refused on purpose.

| Call                                                                                                                                                                                                                                                                                                                                                                                            | Answer                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apply_package_changes`, 13 changes: `app-package` (no `type`); `app-model` for `Move`, `MoveItem`, and `DamageClaim` with `attachments`; `app-model` for the five page providers, the open claims' with `aggregates: "dmg:state,dmg:moveNumber"`; `app-layout` for the three types; `app-form` for the claim's Edit form with `required: "dc:title,dmg:number,dmg:move,dmg:state,dmg:filedOn"` | `written: true`, 19 files, in 6.9 seconds. Each generator's output came back: one card per type, every property in the model's order; "Left out: nothing", for the claim too |
| `apply_package_changes`: `labels/en.json` first, then the four layouts, whole                                                                                                                                                                                                                                                                                                                   | `written: true`, 5 files, in 0.3 seconds: 4 layouts held to the content model, 6 files passed                                                                                |
| `write_package_file`: the claim page with a banner `filed-late`, `visibleWhen` `app.rules.dateAfter` with the two dates and 30                                                                                                                                                                                                                                                                  | **Refused, on purpose:** `written: false`, step 2, `banners[0].visibleWhen: the rule "app.rules.dateAfter" is not registered [unknown]`. The file's SHA-256 unchanged        |
| `apply_package_changes`: `app-queue` twice, then `labels/en.json`, the two queues with their widgets and facets, `home.json` and `navigation.json`, whole, then `app-registry`                                                                                                                                                                                                                  | `written: true`, 6 files, in 1.6 seconds: 10 files passed. `app-registry`: "Now names: home.json, navigation.json"                                                           |
| `write_package_file`: the open claims queue with a third facet, `dmg_adjuster_agg`                                                                                                                                                                                                                                                                                                              | **Refused, on purpose:** step 2, `facets[2].aggregate`: the page provider "has no aggregate "dmg_adjuster_agg": it defines dmg_state_agg, dmg_moveNumber_agg"                |

The edits, written with `write_package_file` from layout-v2.md and app-definition-v2.md:

- **The record pages,** from each generator's one card: the move in four cards (the move, the
  route and dates, the crew, the valuation) with its inventory and claims as related lists, given
  the move's `ecm:uuid`, and the history; the claim in five cards and the history; the item in one
  card and the claims that name it. Widgets a person would pick: `status-badge` with a tone for each
  state, `currency` in USD, `date`, `user` (the crew is a list of users), `phone`, `email`,
  `long-text`, and `document-link` for the four links, which the generator could not choose
  (item 5 below).
- **Banners,** each a registered rule: a move past its delivery date and not delivered
  (`core.every` of `app.rules.fieldIn` and `app.rules.datePassed`), a cancelled move, a denied
  claim. **Not the one asked for, a claim filed late:** see the refusal above, and item 2 below.
- **The days from delivery to filing,** a computed field, `core.dateDiff` of `dmg:deliveredOn` and
  `dmg:filedOn` in days, where the late-filing banner would have been.
- **The rule in plain words,** "a denial reason is required when the state is Denied": `required`
  is for forms only, so on the Edit form's `dmg:denialReason`, as
  `{ "type": "app.rules.fieldIn", "parameters": [{ "field": "dmg:state" }, "Denied"] }`. The form
  also requires the decision day once the claim is `Approved`, `Denied` or `Paid`, and the amount
  approved once `Approved` or `Paid`, with checks that the amount approved is at most the amount
  claimed (`core.atMost`) and that the claim was not filed before delivery (`core.notBefore`).
- **The queues' widgets and facets,** the home and the menu, which have no generator.

### Step 3. Check them: every write already did (05:59, 3 minutes)

| Check                                                                                                                                                                                                   | Result                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run app-package -- business-apps/packages/moves-demo --platform 0.2.0 --model business-apps/packages/moves-demo/content-model.json`                                                                | Passed: 4 layouts held to the model, 10 files passed, sha256 `b79723fa…a15fc`, the last write's                                      |
| The same without `--model`, as CI runs it                                                                                                                                                               | Passed, held to the package's own `content-model.json`, the same SHA-256                                                             |
| `validate_package`                                                                                                                                                                                      | `passed: true`, `asCi: true`, no finding, the same SHA-256                                                                           |
| By hand, what the pipeline does not check (skill, step 3): every property a queue, a related list, a sort, a rule, a computation or a check names, against the type of the file or of its page provider | 100 references, none missing. Seen failing: with `dmg:adjustor` in a queue column and `moveitem:rooms` in a related list, both named |
| The pipeline on that broken copy                                                                                                                                                                        | **Passed:** it does not check queue or related-list columns (item 8 below)                                                           |

### Step 4. Preview in dev mode, as far as it goes (06:02, 4 minutes)

| What                                                                     | Result                                                                                                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview_package`, `DEV_SERVER_URL=http://localhost:4299`, no dev server | `served: true`: the home, the menu, two queues, the labels, the four layouts; `app.json` not served, as the registry's. Not answering                          |
| `npx nx serve nuxeo-ui --port 4299`, after the folder existed            | Up in about three minutes                                                                                                                                      |
| `preview_package` again                                                  | `served: true`; `devServer`: "answers every file as the dev folder holds it"                                                                                   |
| The pages in a browser                                                   | **Not seen.** The browser tool of this run needs a launch configuration under `.claude/`, which it was refused permission to write; nothing worked around that |
| The record pages                                                         | **Not seen, and could not be:** no server holds a `Move`, a `MoveItem` or a `DamageClaim`                                                                      |

What a browser would have shown is what the contracts and facilities kits' runs saw for a kit no
server has installed: the home's figures "Unavailable" and each queue's "Something went wrong",
since the server has none of the five page providers (HTTP 500 in the console). The pages to open
are `#/home`, `#/queues/open-claims` and `#/queues/moves-this-week`; `preview_package` listed the
four layouts as "Open a ... record, from a queue, a search or `#/doc/<its id>`".

### Step 5. Publish to pre-production

**Not done, and not built in the MCP server.** No `app-package/*` tag was pushed. The kit is not
installed anywhere: the orchestrator installs it.

### The seed (06:07, 7 minutes)

Written by hand: the write tools refuse `demo/*.mjs`, as code. On the contracts kit's model. Its
controls, `node business-apps/packages/moves-demo/demo/seed.selftest.mjs`, **30 of 30 passed**.
Broken on purpose thirteen ways, one at a time, each turned at least one control red: no check for
a record that does not belong, no order check, no write over an existing record, no emptied
denial reason, a claim's attachments written over, no wait for the search index, no check of the
facets, a claim linked to its move by number instead of id, no parameter given to a related
list's page provider, the Basic header printed, no `/me` precondition, no type precondition, and
any trashed name like a record's restored.

Two of the REST API's answers the stand-in copies were read from the local Nuxeo, read-only: a
page provider with a `?` is given its value as `queryParams`, and answers 400 without one; and a
page provider of the search index answers `aggregations.<id>.buckets`, each `{ key, docCount }`
(`payers_unassigned_claims`'s `claim_status_agg`).

### After merging staging (07:32, 1 minute)

Staging gained a rule while the kit was built (#731): each kit names its own schemas for the
Properties panel, `layout.schema.<schema>`, which the skill now says and
`kit-schema-labels.spec.ts` in `libs/shared/document-layouts` holds every kit to. After the merge
that spec failed for this kit, naming `layout.schema.move`, `layout.schema.moveitem` and
`layout.schema.damageclaim`. One `write_package_file` of `labels/en.json` with the three texts
answered `written: true`, and the spec passed; the kit was added to its list of kits found.

## Building it

```bash
npm run app-package -- business-apps/packages/moves-demo --platform 0.2.0
```

It writes `dist/moves-demo-0.1.0.zip`, held to the package's own `content-model.json`, since it
ships a stand-in model: sha256 `690b2b54…5348` after the last write, on 26 November 2026.

## Installing it on a local Nuxeo

**Not run.** Installing is the orchestrator's. Written from the contracts kit's install, which
follows the Payers kit's, the one that ran on the same container: the local Nuxeo is the Docker
container `nuxeo`, on port 8080, with `nuxeo-agentic-ui` already installed.

**1. Build it,** as above. **2. Copy it into the container,** then a one-off script that installs
it when the container next starts, and removes itself: `nuxeoctl mp-install` refuses while the
server runs, and the server is the container's main process.

```bash
docker cp business-apps/packages/moves-demo/dist/moves-demo-0.1.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/moves-demo-0.1.0.zip --accept=true > /var/log/nuxeo/moves-kit-install.log 2>&1 || echo "moves kit: install failed, see /var/log/nuxeo/moves-kit-install.log"' 'rm -f "$0"' > /tmp/zz-moves-kit-install.sh && chmod 755 /tmp/zz-moves-kit-install.sh
```

```bash
docker cp /tmp/zz-moves-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it.**

- `/var/log/nuxeo/moves-kit-install.log` lists the package installed, and the server log's
  `Component Loading Status` has nothing pending or missing.
- `/nuxeo/agentic-ui-config/layouts.json` lists `Move`, `MoveItem` and `DamageClaim` in `view`
  mode, and `DamageClaim` in `edit` mode.
- The MCP server's `describe_document_type` `DamageClaim` lists `files:files`, and
  `describe_page_provider` `moves_open_claims` its two aggregates, where step 1 was refused.
- The content model the server answers is `content-model.json`'s. Export it, cut it to the kit's
  types and schemas, and compare:

  ```bash
  npm run app-package:model -- --server http://localhost:8080/nuxeo --out tmp/moves-model.json
  ```

  ```bash
  npm run app-package -- business-apps/packages/moves-demo --platform 0.2.0 --model tmp/moves-model.json
  ```

### Removing it

**Not run.** **First delete the seeded workspace,** `/default-domain/workspaces/moves-demo`, and
empty it from the trash: a document whose type is gone cannot be read. Then a one-off script, as
for the install, with `nuxeoctl mp-remove moves-demo --accept=true`.

## Seeding it

With the package installed and Nuxeo running, from the repository's root:

```bash
export NUXEO_USER=<administrator> NUXEO_PASS=<password>
```

```bash
node business-apps/packages/moves-demo/demo/seed.mjs
```

- **What it writes:** eight moves, eighteen inventory items and five claims, under
  `/default-domain/workspaces/moves-demo`, in `moves`, `inventory` and `claims`, each named by its
  number, or by its move's number and its tag. Dates are counted from the UTC day it runs, so the
  queues hold the same records whichever day that is:
  - **moves this week:** MV-2003 (in transit, delivering in three days) and MV-2004 (loading in
    four), in that order. Not MV-2006, cancelled, nor MV-2005, loading in nine days;
  - **open claims:** DC-3001 (in review), DC-3002 and DC-3003 (filed), oldest filed first. The
    State facet: one `In review`, two `Filed`; the Move facet: two on MV-2001, one on MV-2002;
  - **DC-3003 was filed 43 days after delivery,** the late claim the banner would have flagged:
    its page shows the 43 days. DC-3001 was filed two days after;
  - **DC-3004 is denied,** with its reason, and DC-3005 paid, 600 of the 1,200 claimed;
  - **MV-2008 is past its delivery day and still in transit,** so its page shows the warning.
- **No user and no group.** The kit's groups and the people in them are the server's to decide.
  The coordinators, crews and adjusters are user names only, so the `user` widget shows the name
  as stored.
- **Links are ids,** written in order: the moves, then the items with their move's id, then the
  claims with their move's and items' ids.
- **It never writes a claim's attachments.**
- **Safe to run twice,** as the contracts kit's seed: a record already there is put back to
  `data.mjs`'s values, a property the data leaves empty emptied, a trashed one restored and put
  back, a trashed document whose name only looks like a record's left in the trash, two trashed
  copies of one stop the run, and a place holding a document of another type stops the run,
  untouched.
- **It checks what it wrote:** the five page providers must return every seeded record that
  belongs in them and none that does not, in their order, the related lists given each move's and
  item's id; the open claims are asked again until the search index agrees, up to
  `NUXEO_INDEX_WAIT_MS` (15 seconds by default), and their two facets must count the seeded open
  claims.
- **What it needs:** Node 24, nothing to install. `NUXEO_USER` and `NUXEO_PASS` have no default.
  `NUXEO_URL` defaults to `http://localhost:8080`. Exit 2 means a precondition is not met, before
  anything is written: no credentials, no server, or one that does not answer `/me` as Nuxeo does,
  credentials refused, any of the three types missing, or no `/default-domain/workspaces`.
- **Its controls** run it against a stand-in for the REST API: they prove the script, not the
  server. CI does not run them. 30 controls, each behaviour above among them, and a last one that
  no run, the refused ones included, prints a password or its Basic header.

It prints the home, the two queues, a delivered move, the late claim and the denied claim, on the
app at `APP_URL` (`http://localhost:4200` by default).

## What a server shows, and what the dev server does

| Part                         | Served by the package on a server    | Under `config:dev`                    |
| ---------------------------- | ------------------------------------ | ------------------------------------- |
| The model and page providers | Yes                                  | From the server, so not yet           |
| The four layouts             | Yes, to everyone                     | Yes                                   |
| The home, menu, queues       | From the registry, to the two groups | Yes, and they win over the registry's |
| `labels/en.json`             | From the registry, to the two groups | Yes, and it wins over the registry's  |
| `app.json`                   | From the registry: it lists the app  | No                                    |

Seeing an app is not a security control: Nuxeo's permissions still decide which moves and claims
anyone reads, and the seed sets none, so its workspace has the server's defaults. A hidden card or
banner hides nothing from the REST API.

## Phase 8 feedback: where the tools fell short

What the build met, in the order it met it. Only item 1 was changed here, because it blocked the
kit; the rest are follow-up candidates.

1. **A stand-in type could not have attachments.** `app-model` gave a type `common`, `dublincore`
   and its own schema, and nothing else could write the model, so a claim had no place for a photo.
   **Fixed in this pull request:** `app-model --attachments`, which gives a new type Nuxeo's
   `files` schema. Tiny and kit-blocking, in a commit of its own.
2. **No registered rule compares two dates, or a date with an offset in the past.**
   `app.rules.datePassed` and `app.rules.dateWithin` compare one date with today, forward, and a
   rule's parameters are literals or properties, never a computation, so `core.dateDiff` cannot
   feed one. A banner for a claim filed more than N days after delivery cannot be written; the
   write tools refused `app.rules.dateAfter`, as they should. Candidates: a rule over two dates and
   a number of days, or rules that read a computation.
3. **A record page cannot show a linked record's property.** The claim carries a copy of its
   move's delivery day, which goes stale if the move's changes. layout-v2.md, section 12, proposes
   the fix.
4. **A facet on a `document-link` property buckets by id.** A facet's buckets are the stored
   values, so a Move facet on `dmg:move` would list ids. The claim carries its move's number for
   it. Candidate: a facet bucket shown as its record's title, as `document-link` shows one.
5. **`app-layout` cannot pick `document-link` for a stand-in reference,** since `app-model` binds
   no property to a type (the tutorial's item 7, still): four links were given their widget by
   hand, and the form edits them as ids.
6. **`app-model` writes no complex property,** so a move's inventory cannot be a `table` of items
   with their values on the move: it is a type of its own, listed on the move.
7. **`app-layout` says "Left out: nothing" for a type whose `files` schema it left out.** The skill
   says files are left out "and it says so"; for Nuxeo's own schemas it says nothing.
8. **The pipeline does not check a queue's or a related list's columns and sorts,** even for a
   demo kit whose own model gives each page provider's type: two misspellings passed it, and were
   caught by a check written for this run (package-pipeline.md, section 7, says so).
9. **The MCP server's readers read only the server,** not a demo kit's own model (the tutorial's
   item 6, still): `app-queue`'s output says to check the page provider with
   `describe_page_provider`, which answers that the server has none.
10. **`preview_package` still calls the Edit form "the DamageClaim record page (edit)"** (the
    contracts kit's item 7, the tutorial's item 10).
11. **Dev mode shows a demo kit's shell, not its pages** (the tutorial's item 8): no server has
    the types.
12. **Nothing checks a page provider's NXQL before a server loads it.** `BETWEEN NOW(...)` would
    have passed `app-model` and the pipeline and failed on install; it was found only by a
    read-only query.
13. **The scaffolded `package.xml` and README describe actions** for a package with none (the
    contracts kit's item 10, still).
14. **Nothing in the repository connects an agent to the MCP server without registering it** in
    the person's Claude configuration (the tutorial's item 12): this run used a client of its own,
    outside the repository, as the contracts kit's did.
15. **No generator writes a schema's Properties heading,** `layout.schema.<schema>`, though
    `app-model` writes the schema and `app-layout` a card's label: each kit adds it by hand, and
    only a unit test outside the pipeline, `kit-schema-labels.spec.ts`, asks for it, so the write
    tools passed this kit without it until staging's spec was merged in.
16. **What went well:** every write answered with the files it changed and the pipeline's own
    lines; each refusal named the file, the place and the reason, and left the package as it was;
    the demo-kit order in the skill worked first time in one call; and `app-model --aggregates`
    wrote the facets' page provider, the part the facilities kit wrote by hand.

## Not done yet

- **Installing, seeding, and the live pages:** the orchestrator's.
- **The late-filing banner:** item 2.
- **The photo from a phone:** the capture app is not built; the attachments are its place.
- **The coordinators, crews and adjusters are names, not people.**
- **The Properties panel beside the record page** is version 1's generated one; a `metadata`
  layout would order it.
- **`content-model.json` is `app-model`'s,** until it is exported from a server with the package
  installed.
