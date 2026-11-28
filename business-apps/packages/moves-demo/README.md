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
- **A Damage Claim record page:** the move it belongs to, as a `document-link`, and its move's
  customer, read from the move (`show`, since 0.2.0); the items claimed, each a `document-link` to
  its inventory item; the amounts, the state, the dates, and the claim's **attachments**,
  `files:files`, which is where the driver's photo of demo step 5 goes: since 0.3.0, the phone
  capture page files it there, found by the claim's number or its move's (below).
- **A banner for a claim filed late,** since 0.2.0: more than 30 days after delivery, with the
  registered rule `app.rules.dateAfter`, which this kit's build asked for
  ([below](#phase-8-feedback-where-the-tools-fell-short), item 2). The claim page still shows the
  days from delivery to filing as well, as a computed field (`core.dateDiff`). No Angular code.
- **The claim's Edit form,** with the rule asked for in plain words: "a denial reason is required
  when the state is Denied", as `app.rules.fieldIn`, two more rules of the same kind and two
  checks across fields. The claim's move, move number and delivery day are read-only there:
  the move number and the delivery day are copies of the move's (below).
- **Two queues:** open claims, with facets on state and on move, the move facet showing each move
  by its title since 0.2.0; and the moves this week.
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
- **Recorded on one server, at 0.1.0.** When the kit was built, on the morning of 26 November
  2026, no server had it. By the time 0.2.0 was written, later that day, the local Docker Nuxeo the
  kit was built against had 0.1.0's model installed ([below](#version-020)), and the
  [administrator's guide](../../../docs/business-apps/administrator-guide.md), section 9, records
  the seed run there the same day. No install of 0.2.0 or 0.3.0 is recorded. The package passes the
  pipeline; installing it and seeding it are the orchestrator's
  ([below](#installing-it-on-a-local-nuxeo)).

## What is in it

| File                                                            | What it is                                                                                       | Written by                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `bundle/agentic-ui-config/app.json`                             | The app: id and address `moves`, version 0.3.0, two groups                                       | `app-package`                                                |
| `bundle/agentic-ui-config/layouts/Move/view.layout.json`        | The Move record page: two banners, four cards, the inventory, the claims and the history         | `app-layout`, then `write_package_file`                      |
| `bundle/agentic-ui-config/layouts/MoveItem/view.layout.json`    | An inventory item's page: the item, its move, and the claims that name it                        | `app-layout`, then `write_package_file`                      |
| `bundle/agentic-ui-config/layouts/DamageClaim/view.layout.json` | The Damage Claim record page: two banners, six cards, the attachments and the history, a capture | `app-layout`, then `write_package_file`; 0.3.0's by hand     |
| `bundle/agentic-ui-config/layouts/DamageClaim/edit.layout.json` | The claim's Edit form: the denial reason's rule, two more, two checks, three read-only           | `app-form`, then `write_package_file`                        |
| `bundle/agentic-ui-config/queues/open-claims.json`              | Open claims, oldest filed first, with State and Move facets, the moves by title                  | `app-queue`, then `write_package_file`                       |
| `bundle/agentic-ui-config/queues/moves-this-week.json`          | Moves loading or delivering from today to seven days ahead, both days included                   | `app-queue`, then `write_package_file`                       |
| `bundle/agentic-ui-config/home.json`, `navigation.json`         | The home's three figures, and the menu: the home and the two queues                              | `write_package_file`                                         |
| `bundle/agentic-ui-config/labels/en.json`                       | Every label key the files name, in English                                                       | The generators, then `write_package_file`                    |
| `bundle/OSGI-INF/moves-demo-config.xml`                         | The component: the four layouts, and the app with the five files the registry serves             | The generators                                               |
| `bundle/OSGI-INF/moves-demo-model.xml`, `bundle/schemas/*.xsd`  | **The stand-in model:** three types, a search document, five page providers                      | `app-model`                                                  |
| `content-model.json`                                            | The stand-in model as a server would answer it, which the pipeline holds the kit to              | `app-model`                                                  |
| `package/`, `bundle/META-INF/MANIFEST.MF`, `build.mjs`          | The Marketplace package, the manifest, and version 1's builder, byte for byte                    | `app-package`, `app-model`                                   |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/seed.selftest.mjs`      | The seed script, its fictional records, and its controls. Not packaged                           | By hand: the write tools write no code                       |
| `upgrade-notes.json`                                            | The migration note for 0.2.0's Move facet, which the upgrade check reads                         | By hand, since 0.2.0                                         |
| `README.md`                                                     | This file                                                                                        | `app-package`, then by hand: the write tools write no README |

- **No hand edit to a package file.** Every file under `bundle/`, `package/`, `build.mjs` and
  `content-model.json` was written by `apply_generator`, `write_package_file` or
  `apply_package_changes`, each of which answered `written: true`. Nothing in the model was
  written by hand, unlike the facilities and contracts kits' models.
- **No `actions.json`.** None was asked for, and moving a claim through its states is a property
  here, not a lifecycle (below).
- **One version in three places:** 0.3.0, in `package.xml`, `app.json`'s `packageVersion` and the
  manifest's `Bundle-Version`. `upgrade-notes.json` holds the note for the one item 0.2.0 removes
  ([below](#version-020)); 0.3.0 removes none.
- **0.2.0 was written by hand,** not through the write tools: its edits are the engine's follow-ups
  to items 2 to 4 below, made in the same pull request as the engine, and held to the pipeline with
  `--previous` (below). **So was 0.3.0's one line,** the claim's capture, in the pull request that
  built the capture page ([below](#version-030)).

## The stand-in model

The local Nuxeo had no moves model when the kit was built, and none was given, so the package
carries a fictional one in a component of its own, `moves-demo-model.xml`, as the Payers kit does.

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
- **A claim carries two copies of its move's values:** `dmg:deliveredOn`, which the late-filing
  banner's rule, the days to filing and the Edit form's check read, since a rule, a computation
  and a check read the open record only, never a linked one (item 3 below); and `dmg:moveNumber`,
  which only the Edit form shows since 0.2.0, the Move facet grouping by `dmg:move` (item 4 below).
  The seed writes both from the move.
- **Not folders,** so each opens as a record page. No folder lists the types among its subtypes,
  so the Create menu does not offer them: the seed writes the records.
- **The names are plain:** `Move`, `MoveItem`, `DamageClaim`. The server already has `Claim` and
  the prefix `claim`, the Payers kit's, which is why the claim is `DamageClaim` with `dmg:`.

| Page provider       | Given        | Returns                                                                                                   | Reads            |
| ------------------- | ------------ | --------------------------------------------------------------------------------------------------------- | ---------------- |
| `moves_move_items`  | A move's id  | Its inventory, by tag                                                                                     | The repository   |
| `moves_move_claims` | A move's id  | Its claims, latest filed first                                                                            | The repository   |
| `moves_item_claims` | An item's id | The claims that name it (`dmg:items/* = ?`), latest filed first                                           | The repository   |
| `moves_open_claims` | Nothing      | Claims `Filed` or `In review`, oldest filed first, with the aggregates `dmg_state_agg` and `dmg_move_agg` | The search index |
| `moves_this_week`   | Nothing      | Moves not cancelled that load or deliver from `NOW('-P1D')` to `NOW('P7D')`, by load date                 | The repository   |

- **"This week" is today and the seven days after it,** eight days, not the calendar week: NXQL's
  `NOW()` takes an
  offset from now, not the start of a week. A day stored as midnight is in it from that day to
  seven days ahead.
- **`NOW()` in a `BETWEEN` is a syntax error** on this Nuxeo: `BETWEEN NOW('-P1D') AND NOW('P7D')`
  answered "Invalid token <NOW>", so the condition is written with `>=` and `<=`, which answered 200. Both were run read-only with stock properties in place of `move:` ones.
- **The open claims lag a write by about a second:** only the search index answers aggregates,
  which the facets and the home's figures need.

## Where the driver's photo goes

Phase 8's demo step 5 has a driver photograph damaged goods on a phone, and the photo filed on
the claim of the move. **Since 0.3.0 the claim's layout turns the phone capture page on**
([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 2, "Capture"):

```json
"capture": { "property": "files:files", "findBy": ["dmg:number", "dmg:moveNumber"] }
```

- **The driver opens `/#/capture` on the phone,** types or scans the move's number, `MV-2003`, or
  the claim's, `DC-3003`, and the page finds the claim: a claim keeps its move's number as
  `dmg:moveNumber`, so the move's number finds the claims of the move, and the driver chooses one
  when there are several. The claim page links to the same page for anyone who may write the
  claim.
- **The photos go to the claim's attachments, `files:files`,** as the document page's Attachments
  panel uploads one, with the driver's own permission, which the server checks. The claim page's
  Attachments card lists them, with `file-list`, which shows each file's name until it has its
  lookup (layout-v2.md, section 11).
- **Where each photo was taken is taken out** before it is sent: the capture keeps no location,
  since `keepLocation` is not set. A move's addresses are on the move already.
- **The seed never writes `files:files`,** so a photo filed on a claim stays through a second run.
- **Not seen on a server:** no install of 0.3.0 is recorded, and the one server recorded with the
  kit, the local Docker Nuxeo, had 0.1.0's model on 26 November 2026. The page was run against a
  stand-in of the server with this kit's layout and model, at a phone's 320 pixels
  (`scripts/beta-harness/steps/capture-phone.mjs`).

## How it was built: the log

Run on 26 November 2026, from 05:25 to 08:15 IST, in a worktree of
`staging/enterprise-grade-app` at `749cbd660`, on Node 24.22.1, against the local Docker Nuxeo
(container `nuxeo`, port 8080, which had the Satori package and the Payers and contracts kits
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
| A server whose model may be shared | The local Docker Nuxeo, which held fictional records only                      |
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

Three writes, each answering `written: true`, and two refused on purpose. **A departure:** the
skill says never to invent an id, and the first refusal wrote one, `app.rules.dateAfter`, as a
negative control of the write tools, as the contracts kit's run did with `app.rules.statusIs`. It
shows that an unregistered rule is refused at write time and the package left as it was; it is not
the evidence that no rule fits, which is the registry (`PACKAGED_REGISTRIES`, item 2 below).

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
  the move's `ecm:uuid`, and the history; the claim in five cards and the history, six in all; the
  item in one
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
  After the review (below), the move, its number and the delivery day, which are copies, were made
  read-only there with `readOnlyWhen` `core.true`, so a typed value cannot part them from the move.
- **The queues' widgets and facets,** the home and the menu, which have no generator.

### Step 3. Check them: every write already did (05:59, 3 minutes)

| Check                                                                                                                                                                                                   | Result                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run app-package -- business-apps/packages/moves-demo --platform 0.2.0 --model business-apps/packages/moves-demo/content-model.json`                                                                | Passed: 4 layouts held to the model, 10 files passed, sha256 `b79723fa…a15fc`, the last write's                                      |
| The same without `--model`, as CI runs it                                                                                                                                                               | Passed, the same SHA-256. Not more evidence: a kit with a stand-in model is held to its own `content-model.json` either way          |
| `validate_package`                                                                                                                                                                                      | `passed: true`, `asCi: true`, no finding, the same SHA-256: the same check again, as the MCP server runs it                          |
| By hand, what the pipeline does not check (skill, step 3): every property a queue, a related list, a sort, a rule, a computation or a check names, against the type of the file or of its page provider | 100 references, none missing. Seen failing: with `dmg:adjustor` in a queue column and `moveitem:rooms` in a related list, both named |
| The pipeline on that broken copy                                                                                                                                                                        | **Passed:** it does not check queue or related-list columns (item 8 below)                                                           |

### Step 4. Preview in dev mode, as far as it goes (06:02, 4 minutes)

| What                                                                     | Result                                                                                                                                                         |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview_package`, `DEV_SERVER_URL=http://localhost:4299`, no dev server | `served: true`: the home, the menu, two queues, the labels, the four layouts; `app.json` not served, as the registry's. Not answering                          |
| `npx nx serve nuxeo-ui --port 4299`, after the folder existed            | Up in about three minutes                                                                                                                                      |
| `preview_package` again                                                  | `served: true`; `devServer`: "answers every file as the dev folder holds it"                                                                                   |
| The pages in a browser                                                   | **Not seen.** The browser tool of this run needs a launch configuration under `.claude/`, which it was refused permission to write; nothing worked around that |
| The record pages                                                         | **Not seen, and could not be:** no server held a `Move`, a `MoveItem` or a `DamageClaim`                                                                       |

What a browser would have shown is what the contracts and facilities kits' runs saw for a kit no
server has installed: the home's figures "Unavailable" and each queue's "Something went wrong",
since the server has none of the five page providers (HTTP 500 in the console). The pages to open
are `#/home`, `#/queues/open-claims` and `#/queues/moves-this-week`; `preview_package` listed the
four layouts as "Open a ... record, from a queue, a search or `#/doc/<its id>`".

### Step 5. Publish to pre-production

**Not done, and not built in the MCP server.** No `app-package/*` tag was pushed. When the run
ended the kit was installed nowhere: the orchestrator installs it.

### The seed (06:07, 7 minutes)

Written by hand: the write tools refuse `demo/*.mjs`, as code. On the contracts kit's model. Its
controls, `node business-apps/packages/moves-demo/demo/seed.selftest.mjs`, **32 of 32 passed**
(30 before the review added two for `/me`). Broken on purpose fifteen ways, one at a time, each
turned at least one control red: no check for
a record that does not belong, no order check, no write over an existing record, no emptied
denial reason, a claim's attachments written over, no wait for the search index, no check of the
facets, a claim linked to its move by number instead of id, no parameter given to a related
list's page provider, the Basic header printed, no `/me` precondition, no check that `/me`
answers a user, an answer that is not JSON not taken as a precondition, no type precondition,
and any trashed name like a record's restored.

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

The release candidate, `node scripts/release-candidate.mjs --since origin/staging/enterprise-grade-app`,
assembled whole with this kit among the five, new and held to nothing: its stage 3, the kits as a
set, compared 27 of its names with the other kits' and found no clash. Before the merge it was
refused, for the other four kits: the branch's copies were a patch version behind staging's.

### The independent review (07:40, 15 minutes)

A reviewer agent, given the request, the skill and the documents and not this log, read the kit,
ran the pipeline, the controls and a property check of its own, and found nothing blocking. What
it found, and what was done:

| Finding                                                                                                           | Done                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| The branch changes a generator, which the skill says not to                                                       | Kept, as item 1 below says, and flagged in the pull request for the generator's owner; approved by the plan's author on 26 November 2026        |
| The administrator guide's groups table leaves out `moves`                                                         | Added, with the seed's creating no group                                                                                                        |
| The server validator's parity corpus (`KIT_NAMES` in `server-validator-build.mjs`) lists the four other kits only | Added, the corpus written again with `npm run app-definition:server-validator`; `DeploymentValidatorParityTest` passed with Maven, and its spec |
| The Edit form lets a person type the copies, `dmg:moveNumber` and `dmg:deliveredOn`, apart from `dmg:move`        | The three made read-only with `readOnlyWhen` `core.true`, through `write_package_file`: `written: true`                                         |
| Two rows of step 3 repeat the first on the same model; the `dateAfter` refusal is self-confirming                 | Said so, above                                                                                                                                  |
| Counts: "three more" rules, "five cards" counted twice, "seven days", "must count"                                | Corrected                                                                                                                                       |
| The seed's `/me` precondition caught an error status only: a 200 page exited 1, and any JSON passed               | `/me` must answer a user, and an answer that is not JSON is a precondition; two controls more, each seen failing with its check removed         |
| One crew member's user name was a well-known video game character's                                               | Renamed `ezra.lund`                                                                                                                             |

## Building it

```bash
npm run app-package -- business-apps/packages/moves-demo --platform 0.2.0
```

It writes `dist/moves-demo-0.3.0.zip`, held to the package's own `content-model.json`, since it
ships a stand-in model: sha256 `f4d3b319…1e19` for 0.3.0, on 26 November 2026 (`fbd58658…ef91`
for 0.2.0).

## Installing it on a local Nuxeo

**Not run when it was written,** on 26 November 2026, with 0.1.0. Installing is the orchestrator's.
0.1.0's model was on the local Docker Nuxeo later that day ([Version 0.2.0](#version-020)); how it
was installed, and the checks of step 3 below, are not recorded here. Written from the contracts
kit's install, which follows the Payers kit's, the one that ran on the same container: the local
Nuxeo is the Docker container `nuxeo`, on port 8080, with `nuxeo-agentic-ui` already installed.

**1. Build it,** as above. **2. Copy it into the container,** then a one-off script that installs
it when the container next starts, and removes itself: `nuxeoctl mp-install` refuses while the
server runs, and the server is the container's main process.

```bash
docker cp business-apps/packages/moves-demo/dist/moves-demo-0.3.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/moves-demo-0.3.0.zip --accept=true > /var/log/nuxeo/moves-kit-install.log 2>&1 || echo "moves kit: install failed, see /var/log/nuxeo/moves-kit-install.log"' 'rm -f "$0"' > /tmp/zz-moves-kit-install.sh && chmod 755 /tmp/zz-moves-kit-install.sh
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
  `NUXEO_INDEX_WAIT_MS` (15 seconds by default), and their two facets must count at least the seeded open
  claims.
- **What it needs:** Node 24, nothing to install. `NUXEO_USER` and `NUXEO_PASS` have no default.
  `NUXEO_URL` defaults to `http://localhost:8080`. Exit 2 means a precondition is not met, before
  anything is written: no credentials, no server, or one that answers `/me` with an error, with
  something that is not JSON, or with no user,
  credentials refused, any of the three types missing, or no `/default-domain/workspaces`.
- **Its controls** run it against a stand-in for the REST API: they prove the script, not the
  server. CI does not run them. 32 controls, each behaviour above among them, and a last one that
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

## Version 0.3.0

The claim's capture, for the phone capture page that phase 8's demo step 5 needs, on 26 November
2026, in the pull request that built the page. Held to 0.2.0 on the staging branch with
`--previous`: one change, a key in the claim's record page, which needs a patch; 0.3.0 raises the
minor, for a new feature, as 0.2.0 did. The upgrade check keeps every configuration.

- **The capture:** photos go to `files:files`, and a number typed or scanned is looked up in
  `dmg:number` and `dmg:moveNumber`, so that the move's number finds its claims. No location is
  kept.
- **The claim page links to the capture page** for a reader who may write the claim: the record
  page's own, from the capture, with nothing of the kit's.
- **No label, no menu entry.** The page's words are the platform's. A menu entry for the page would
  be a platform menu entry, a public ID that the menu names ([app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md),
  section 9), which the platform does not have: the driver opens `/#/capture`, or the claim
  page's link.

## Version 0.2.0

The engine's answers to items 2 to 4 below, adopted by the kit on 26 November 2026, in the pull
request that built them. Held to 0.1.0 on the staging branch with `--previous`: six changes, which
need a patch; 0.2.0 raises the minor, for three new features.

- **The late-filing banner,** `filed-late`, a warning: "This claim was filed more than 30 days after
  delivery", while `app.rules.dateAfter` passes for `dmg:filedOn`, `dmg:deliveredOn` and 30. A
  claim filed on the 30th day after delivery shows none, and one filed on the 31st does. Of the
  seed's five claims, DC-3003, filed 43 days after its move's delivery, shows it.
- **The claim's customer, read from its move,** a `document-link` with `show: "move:customer"` in
  the claim card: the move's own value, read with the move's title in the page's one search for
  linked records, with the reader's permissions. A move the reader may not read shows
  "Unavailable".
- **The open claims' Move facet groups by `dmg:move`,** the aggregate `dmg_move_agg`, and shows each
  move by its title, `"widget": "document-link"`, read in one search with the queue's own linked
  records. It replaces `dmg_moveNumber_agg`, whose buckets were the copied move numbers: its removal
  from the search document is the one item `upgrade-notes.json` covers, which keeps the upgrade
  check whole.
- **Not done: `dmg:deliveredOn` stays a copy** on the claim, though the page could show the move's
  own `move:deliveredOn` through `show`. The banner's rule, the days to filing and the Edit form's
  `core.notBefore` all read it, and a rule, a computation and a check read the open record only:
  decision 4 gave rules a field's value to read, a computation makes no request
  ([layout-v2.md](../../../docs/business-apps/layout-v2.md), sections 4 and 5), and section 12's
  `show` is a widget's, not a rule's. Removed, the three would lose their date; shown beside it from
  the move, the page would show two delivery days that could differ, and the banner would follow
  the one not shown. So the copy stays, and goes stale if a move's delivery day changes after its
  claims are filed, as before. The days to filing still say what the banner reads.
- **`dmg:moveNumber` stays too,** though nothing but the Edit form shows it now: dropping a property
  is a change to the model, which the kit's stand-in leaves for a real one.
- **Not seen in a browser or on a server:** when 0.2.0 was written, on 26 November 2026, the local
  Nuxeo had 0.1.0's model installed, and no install of 0.2.0 is recorded; installing is the
  orchestrator's. The pages are held by the engine's specs, the pipeline and the
  seed's controls, 32 of 32, its open-claims check now finding each move's bucket by the move's id.

## Phase 8 feedback: where the tools fell short

What the build met, in the order it met it. Only item 1 was changed in the pull request that built
the kit, because it blocked it; items 2 to 4 were built in a later one, and the kit adopted them in
0.2.0 ([above](#version-020)); the rest are follow-up candidates.

1. **A stand-in type could not have attachments.** `app-model` gave a type `common`, `dublincore`
   and its own schema, and nothing else could write the model, so a claim had no place for a photo.
   **Fixed in this pull request:** `app-model --attachments`, which gives a new type Nuxeo's
   `files` schema. Tiny and kit-blocking, in a commit of its own. Approved by the plan's author,
   for the generators' owner, on 26 November 2026 ([decisions.md](../../../docs/business-apps/decisions.md),
   "Settled").
2. **No registered rule compares two dates, or a date with an offset in the past.**
   `app.rules.datePassed` and `app.rules.dateWithin` compare one date with today, forward, and a
   rule's parameters are literals or properties, never a computation, so `core.dateDiff` cannot
   feed one. A banner for a claim filed more than N days after delivery cannot be written; the
   write tools refused `app.rules.dateAfter`, as they should. Candidates: a rule over two dates and
   a number of days, or rules that read a computation.
   **Done:** `app.rules.dateAfter`, two dates, either of them `"today"`, and a whole number of
   days, true when the first is more than that many days after the second
   ([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 5). Registered, known to the
   validator, the server's and the layout designer's, and the kit's late-filing banner uses it. A
   rule reading a computation is not built: it does not fit decision 4's shape, and section 5 says
   why.
3. **A record page cannot show a linked record's property.** The claim carries a copy of its
   move's delivery day, which goes stale if the move's changes. layout-v2.md, section 12, proposes
   the fix.
   **Done:** section 12 is built, `show` on `document-link`, in a record page's fields and a list's
   columns, read in the page's one search for linked records with the reader's permissions; the
   section says where it departs from the proposal. The kit shows its move's customer through it.
   **The copy of the delivery day stays,** since the banner, the days to filing and the Edit form's
   check read it, and they read the open record only ([above](#version-020)).
4. **A facet on a `document-link` property buckets by id.** A facet's buckets are the stored
   values, so a Move facet on `dmg:move` would list ids. The claim carries its move's number for
   it. Candidate: a facet bucket shown as its record's title, as `document-link` shows one.
   **Done:** a queue's facet takes `"widget": "document-link"`, and shows each bucket by its
   record's title, read in one search, with the reader's permissions, and the key where a title
   cannot be read ([app-definition-v2.md](../../../docs/business-apps/app-definition-v2.md),
   section 4). The kit's Move facet groups by `dmg:move` with it.
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
11. **Dev mode shows a demo kit's shell, not its pages** (the tutorial's item 8): no server had
    the types when the kit was built.
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
16. **Two lists of kits are kept by hand, and leave a new one out in silence:** the server
    validator's parity corpus, `KIT_NAMES` in `server-validator-build.mjs`, and the administrator
    guide's tables. The release candidate and CI read `business-apps/packages/` instead. Neither
    the skill nor a check says to add a kit to them; the review found both.
17. **What went well:** every write answered with the files it changed and the pipeline's own
    lines; each refusal named the file, the place and the reason, and left the package as it was;
    the demo-kit order in the skill worked first time in one call; and `app-model --aggregates`
    wrote the facets' page provider, the part the facilities kit wrote by hand.

## Not done yet

- **Installing, seeding, and the live pages:** the orchestrator's. What is recorded of them: 0.1.0's
  model on the local Docker Nuxeo on 26 November 2026, and its seed run there the same day, in the
  administrator's guide; no install of 0.2.0 or 0.3.0, and no page seen on a server.
- **The delivery day read from the move** for the banner and the days to filing: a rule reads the
  open record only ([above](#version-020)).
- **The photo from a phone on a server:** the capture page files it, since 0.3.0, and has been run
  against a stand-in of the server only.
- **The coordinators, crews and adjusters are names, not people.**
- **The Properties panel beside the record page** is version 1's generated one; a `metadata`
  layout would order it.
- **`content-model.json` is `app-model`'s,** until it is exported from a server with the package
  installed.
