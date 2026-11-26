# Vehicle deals and titles (demo)

One of phase 8's kits for case management: vehicle deals, and the titles of the vehicles they
sell and take in trade ([development plan](../../../docs/business-apps/development-plan.md), phase
8, "Builds"). It was built the way phase 3 says kits are built, as the
[moves](../moves-demo/README.md), [P&C claims](../pc-claims-demo/README.md) and
[onboarding](../onboarding-demo/README.md) kits were: an agent took the app builder skill's steps
([`.cursor/skills/app-builder/SKILL.md`](../../../.cursor/skills/app-builder/SKILL.md)) in order,
with the generators, the package pipeline and the Builder MCP server, and wrote the app definition
**through the server's write tools**, which commit a change only when the pipeline passes it. What
the tools could not write, the deal's checklist schema, was written by hand, as the onboarding kit's
was, and the log says so at each step. Every name in it is fictional. The log of each step, its
result, its time and each departure is [below](#how-it-was-built-the-log).

## The short version

- **A Vehicle Deal record page:** the deal (its status, the days it was sold and delivered, the
  salesperson and the finance manager), the buyer, the vehicle (VIN, year, make, model), the price
  and its finance (cash, a loan or a lease, the lender, the amount and the term), the trade-in, and
  the deal's **title**, a `document-link` to the Title record with its number, state of issue,
  status and lien holder read from it (`show`). Then:
  - **a checklist of required documents,** layout version 2's checklist card, **tickable** by
    anyone who may write the deal: the buyer's driver's license, proof of insurance, the signed
    buyer's order, the odometer disclosure statement, the title and registration application and
    the signed delivery receipt; and, for a loan or a lease only, a second card of the same
    checklist: the credit application, the finance contract and the lender's approval;
  - **documents and photos** as the deal's attachments, `files:files`, which **the phone capture
    page files**: the deal's layout turns it on, with `capture`, and finds a deal by its number or
    its VIN, typed or scanned ([below](#photos-and-documents-from-a-phone));
  - **banners** for a cancelled deal, and for a financed deal still contracted and not funded more
    than 10 days after the sale, with `app.rules.dateAfter`.
- **A Vehicle Title record page:** the title number, the state of issue, the status, the owner of
  record and the clerk; the vehicle; the **lien**, its holder, the day the payoff went and the days
  since, and the day it was released; the title work's dates; and **its deals**, as two related
  lists: the deals that sell the vehicle, and the deals that take it in trade. A banner while it
  waits for its lien release, and one when it is **overdue**: open more than 30 days and not
  issued, with `app.rules.dateAfter` and `"today"`.
- **Three queues:** deals missing documents, sold deals with a document not yet in, oldest sale
  first, each with its title's status; titles awaiting lien release, the oldest payoff first, with
  facets on the lien holder and the state; and titles overdue, the longest open first.
- **A home, a menu and labels.** Deals missing documents and titles overdue for everyone; titles
  awaiting lien release, by lien holder, for title clerks, whose queue and menu entry are theirs
  too.
- **An `app.json` that names its own groups,** `vehicle-deal-desk` and `vehicle-title-clerks`, and a
  component that contributes the app to the app registry. Its id and address are `vehicle-titles`,
  which is not a platform route (`PLATFORM_ROUTES` in `libs/shared/app-definition`).
- **A stand-in model, in its own components:** `VehicleDeal` and `VehicleTitle`, their schemas, a
  search document and five page providers, written by `app-model`; and the deal's checklist schema,
  `vehicledeal_docs`, written by hand. Fictional, and replaced whole when a real one comes.
- **A seed script,** with its controls, writing eight fictional titles and eight deals. It creates
  no user and no group.
- **Not installed anywhere.** The package passes the pipeline; installing it and seeding it are a
  person's ([below](#installing-it-on-a-local-nuxeo)).

## What is in it

| File                                                                                                                            | What it is                                                                                                | Written by                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `bundle/agentic-ui-config/app.json`                                                                                             | The app: id and address `vehicle-titles`, version 0.1.0, two groups                                       | `app-package`                                                |
| `bundle/agentic-ui-config/layouts/VehicleDeal/view.layout.json`                                                                 | The deal page: two banners, the capture, six cards, two checklists, the attachments, notes and history    | `app-layout`, then `write_package_file`                      |
| `bundle/agentic-ui-config/layouts/VehicleTitle/view.layout.json`                                                                | The title page: two banners, four cards, its deals sold and taken in trade, notes and history             | `app-layout`, then `write_package_file`                      |
| `bundle/agentic-ui-config/queues/vehicle-deals-missing-documents.json`                                                          | Sold deals with a document not in, oldest sale first, with each one's title status                        | `app-queue`, then `write_package_file`                       |
| `bundle/agentic-ui-config/queues/vehicle-titles-awaiting-lien-release.json`                                                     | Titles waiting for their lien release, oldest payoff first, with Lien holder and State facets, for clerks | `app-queue`, then `write_package_file`                       |
| `bundle/agentic-ui-config/queues/vehicle-titles-overdue.json`                                                                   | Titles open more than 30 days and not issued, the longest open first                                      | `app-queue`, then `write_package_file`                       |
| `bundle/agentic-ui-config/home.json`, `navigation.json`                                                                         | The home's three figures, and the menu: the home and the three queues                                     | `write_package_file`                                         |
| `bundle/agentic-ui-config/labels/en.json`                                                                                       | Every label key the files name, in English, and each schema's Properties heading                          | The generators, then `write_package_file`                    |
| `bundle/OSGI-INF/vehicle-titles-demo-config.xml`                                                                                | The component: the two layouts, and the app with the six files the registry serves                        | The generators                                               |
| `bundle/OSGI-INF/vehicle-titles-demo-model.xml`, `bundle/schemas/vehicledeal.xsd`, `vehicletitle.xsd`, `vehicletitlesearch.xsd` | **The stand-in model:** two types, a search document, five page providers                                 | `app-model`                                                  |
| `bundle/OSGI-INF/vehicle-titles-demo-checklist.xml`, `bundle/schemas/vehicledeal_docs.xsd`                                      | The deal's checklist of required documents, added to `VehicleDeal`                                        | **By hand** (the log, step 2)                                |
| `bundle/META-INF/MANIFEST.MF`                                                                                                   | The bundle's manifest, which names the three components                                                   | `app-package`, `app-model`, then **by hand**                 |
| `content-model.json`                                                                                                            | The stand-in model as a server would answer it, which the pipeline holds the kit to                       | `app-model`, then **by hand**                                |
| `package/`, `build.mjs`                                                                                                         | The Marketplace package and version 1's builder, byte for byte                                            | `app-package`                                                |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/seed.selftest.mjs`                                                                      | The seed script, its fictional records, and its controls. Not packaged                                    | By hand: the write tools write no code                       |
| `README.md`                                                                                                                     | This file                                                                                                 | `app-package`, then by hand: the write tools write no README |

- **Every app definition file went through the write tools,** each write answering
  `written: true`: the layouts, queues, home, menu, labels, `app.json` and the component. **Four
  files were changed by hand,** because no write tool writes what they needed (the log, step 2):
  the checklist's schema and its component, the manifest that lists that component, and the
  content model's entries for the schema.
- **Every app definition file is written as the layout designer writes it,** the repository's
  Prettier given the value on one line, so the designer's round trip holds each byte for byte. No
  file of the kit is in its `NOT_BYTE_FOR_BYTE` list.
- **No `actions.json`, and no Edit form.** None was asked for: a deal's and a title's statuses are
  properties here, not lifecycles, and the platform's own Edit form changes them.
- **One version in three places:** 0.1.0, in `package.xml`, `app.json`'s `packageVersion` and the
  manifest's `Bundle-Version`.

## The stand-in model

The request asked for a demo kit with fictional data, and no server holds a vehicle model, so the
package carries a fictional one, as the moves and P&C claims kits do.

| Type           | Schema (prefix)                                       | What it holds                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VehicleDeal`  | `vehicledeal` (`vdeal`), `vehicledeal_docs` (`vdocs`) | `number`, `buyer`, `buyerEmail`, `buyerPhone`, `vin`, `year`, `make`, `model`, `price`, `financeType`, `lender`, `amountFinanced`, `termMonths`, `tradeIn`, `tradeInVehicle`, `tradeInVin`, `tradeInAllowance`, `tradeInPayoff`, `tradeInTitle` (its title's id), `title` (its title's id), `status`, `salesperson`, `financeManager`, `soldOn`, `deliveredOn`, `notes`; and `vdocs:checklist` |
| `VehicleTitle` | `vehicletitle` (`vtitle`)                             | `number`, `issuingState`, `vin`, `vehicle`, `owner`, `status`, `lienHolder`, `payoffSentOn`, `lienReleasedOn`, `openedOn`, `submittedOn`, `issuedOn`, `clerk`, `notes`                                                                                                                                                                                                                         |

- **`VehicleDeal` also has Nuxeo's `files` schema,** `files:files`, its attachments, from
  `app-model --attachments`, where the capture page files photos. The type still opens as a record
  page: only the `file` and `note` schemas keep a record's own view.
- **The checklist is `vdocs:checklist`,** a list of complex values, `item`, `done`, `doneBy` and
  `doneOn`, the shape layout version 2's checklist card reads (layout-v2.md, section 7), in a schema
  of its own, `vehicledeal_docs`, which a component of its own adds to the type:
  `vehicle-titles-demo-checklist.xml`, `<doctype name="VehicleDeal" append="true">`. Its Properties
  heading is "Required documents".
- **Statuses are properties,** stored as the words the pages show: `vdeal:status` is `Working`,
  `Contracted`, `Funded`, `Delivered` or `Cancelled`; `vdeal:financeType` `Cash`, `Loan` or `Lease`;
  `vtitle:status` `Awaiting title`, `Awaiting lien release`, `In hand`, `Submitted to state` or
  `Issued`. The types have the platform's default lifecycle, which nothing here reads.
- **The model year is text,** `vdeal:year`, not a number: a `long` shows grouped, as "2,024", on a
  record page and in a list (feedback, item 5).
- **A deal links its titles; a title lists its deals.** A deal holds two ids, its vehicle's title
  and its trade-in's; the title page lists the deals that name it in either, in two related lists.
  A vehicle sold twice, the first sale unwound, lists both deals. The deal page reads the title's
  number, state, status and lien holder from the title, with `show`, so nothing goes stale.
- **Not folders,** so each opens as a record page. No folder lists the types among its subtypes, so
  the Create menu does not offer them: the seed writes the records.
- **The names say what they are,** and clash with no other kit's (the release candidate's stage 3,
  below): `VehicleDeal`, `VehicleTitle`, the prefixes `vdeal`, `vtitle` and `vdocs`, and every page
  provider beginning `vtitles_`.

| Page provider                     | Given        | Returns                                                                                                                            | Reads            |
| --------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `vtitles_deals_missing_documents` | Nothing      | Deals `Contracted`, `Funded` or `Delivered` with a checklist entry not done, `vdocs:checklist/*/done = 0`, oldest sale first       | The repository   |
| `vtitles_overdue_titles`          | Nothing      | Titles not `Issued` opened before `NOW('-P31D')`, the longest open first                                                           | The repository   |
| `vtitles_awaiting_lien_release`   | Nothing      | Titles `Awaiting lien release`, the oldest payoff first, with the aggregates `vtitle_lienHolder_agg` and `vtitle_issuingState_agg` | The search index |
| `vtitles_title_sales`             | A title's id | The deals that sell its vehicle (`vdeal:title = ?`), latest sale first                                                             | The repository   |
| `vtitles_title_trade_ins`         | A title's id | The deals that take it in trade (`vdeal:tradeInTitle = ?`), latest sale first                                                      | The repository   |

### Deals missing documents

- **"Missing" is a checklist entry not done.** NXQL can say that one entry of a list is not done; it
  cannot say that not every item a layout lists is done, since the items are the layout's, not the
  model's. So a deal is listed when its checklist has an entry not done, and **a deal must have an
  entry for each of its documents** to be listed for the one it lacks. The seed writes them all, done
  or not; a tick sets one done, and an untick keeps it, not done. A deal written some other way with
  no entry for a document is not listed for it (feedback, item 6).
- **Sold deals only:** a deal still `Working` lacks documents as a matter of course, and a
  `Cancelled` one needs none.
- **It reads the repository,** not the search index, so it does not lag a tick, and the query over a
  list's subfield is the repository's to answer. **Not run on a server:** the local Nuxeo was not
  read (the log, step 1). The seed checks it against what it seeded, and names a deal listed twice.

### Titles overdue: the queue and the banner say the same

- **Overdue is more than 30 days open and not issued.** The title page's banner says it with
  `app.rules.dateAfter`, `["today", { "field": "vtitle:openedOn" }, 30]`: today more than 30 days
  after the day the title work opened, counted in days. A title open 30 days shows no banner; one
  open 31 does.
- **The queue says it in NXQL,** `vtitle:openedOn < NOW('-P31D')`: a day stored at UTC midnight that
  is at least 31 days before now. `NOW('-P30D')` would list the title open 30 days, which the banner
  does not flag. The two agree on the UTC day, as the seed counts its dates; near midnight, a reader
  far from UTC may see the banner a day before or after the queue lists the title.
- **Nothing outside the kit holds them together:** a rule and a page provider are written apart. The
  seed's controls read both files and fail when they differ, and the seed's data has a title open
  30 days and one open 31, which a server's run tells apart.

## Photos and documents from a phone

Phase 8's phone capture page, `/#/capture` ([`libs/features/capture`](../../../libs/features/capture/README.md)),
files photos on a record whose layout turns it on. **The deal's does**
([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 2, "Capture"):

```json
"capture": { "property": "files:files", "findBy": ["vdeal:number", "vdeal:vin"] }
```

- **The salesperson or the title clerk opens `/#/capture` on a phone,** types the deal's number,
  `VD-5002`, or scans its VIN from the vehicle's door or windshield, and the page finds the deal. A
  vehicle sold twice has two deals with its VIN, the unwound one among them: the page lists both to
  choose from. The deal page links to the same page for anyone who may write the deal.
- **The photos go to the deal's attachments,** `files:files`: a photographed driver's license or
  insurance card, a signed page, the odometer. The deal page's "Documents and photos" card lists
  them with `file-list`, and the document page's Attachments panel previews them. **A photo is not a
  tick:** the person who files it ticks the checklist item it stands for.
- **Where each photo was taken is taken out** before it is sent: `keepLocation` is not set.
- **The seed never writes `files:files`,** so a photo filed on a deal stays through a second run.
- **Not seen:** no server has the kit, and the capture page has been run against the moves kit's
  stand-in only (`scripts/beta-harness/steps/capture-phone.mjs`).

## How it was built: the log

Run on 27 November 2026, from 00:27 to 02:30 IST, before the pull request, in a worktree of
`staging/enterprise-grade-app` at `886188ba6`, on Node 24.22.1, the major `.nvmrc` pins, for every
command, `npm ci` included, as the skill's agent. The agent spoke to the Builder MCP server over
stdio, as Claude Code does once the server is registered, through a small client of its own outside
the repository, as the moves, P&C claims and onboarding kits' runs did: registering the server with
`claude mcp add-json` changes the person's own Claude configuration, which was not asked for.
**Nothing was written to any Nuxeo, and nothing was read from one** (step 1). The times are the
agent's, from its commands' timestamps.

### Step 0. Before you start (00:27, 2 minutes)

| What                               | Result                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm ci`, Node 24.22.1             | Passed in 26 seconds. `package-lock.json`'s SHA-256 the same before and after                 |
| `NUXEO_USER`, `NUXEO_PASS`         | **Not in this run's environment.** The request says to work without a server then, and say so |
| A server whose model may be shared | The local Docker Nuxeo, read-only by the request's rules; not read (step 1)                   |
| The platform version               | `0.2.0`, from `libs/platform/package.json`                                                    |

Reading the plan's phase 8, the skill, the decisions, the three kits' READMEs and layout-v2.md's
sections on the checklist, rules, capture, the `external` card and `show` took about 14 minutes;
writing the client, 2 more.

### Step 1. Read the server (00:43, 4 minutes)

| Asked                                                                                                  | Answer                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_content_model`, the client passing the whole environment to the server                            | **Refused by the session's permission system before it ran,** and so was `validate_package` on the moves kit with the same client. Nothing worked around it                    |
| `validate_package` `moves-demo`, the client giving the server `PATH`, `HOME`, `TMPDIR` and `LANG` only | Answered: `passed: true`, `asCi: true`, moves-demo 0.3.0, the zip's SHA-256 `f4d3b319…1e19` as its README has it. The server said its Nuxeo tools would refuse: no credentials |
| The other kits' names, read from their folders                                                         | None of `VehicleDeal`, `VehicleTitle`, `vehicledeal`, `vehicletitle`, `vdeal:`, `vtitle:`, `vdocs:`, `vtitles_`, `vehicle-titles` or the two groups in any other kit           |

**A departure:** the skill's step 1 reads the server, and this run did not. The server's tools need
an account, the environment had none, and the request says to work without a server then. The
names were checked against the other kits instead, and later against every kit as a set by the
release candidate (below). What a read would have added: the server's stock names, and the NXQL
run read-only, above all the checklist's `vdocs:checklist/*/done = 0` and `NOW('-P31D')`, which
nothing here has run (feedback, item 7).

**The skill says to stop here** when a type is missing: creating it is Studio's. The request asked
for a demo kit with a stand-in model, so the kit carries one, written by `app-model` where it can be.

### Step 2. Write the files, through the write tools (00:55 to 01:05, 10 minutes)

Four writes, each answering `written: true`, one set of hand edits between them, and three writes
refused on purpose, as negative controls of the write tools, which show that a refusal leaves the
package as it was; they are not evidence that the kit is right, which the rest of this log is.

| Call                                                                                                                                                                                                                                                                                                                                    | Answer                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apply_package_changes`, 9 changes: `app-package` (no `type`; owner `nuxeo`, app `vehicle-titles`, two groups); `app-model` for `VehicleTitle`, and `VehicleDeal` with `attachments`; `app-model` for four page providers, the lien release one with `aggregates: "vtitle:lienHolder,vtitle:issuingState"`; `app-layout` for both types | `written: true`, 16 files, in 6.8 seconds. One card per type, every property in the model's order; "Left out" named `files:files` for the deal, "a file-list widget shows them on the record page, written by hand"     |
| **By hand, outside the write tools** (below): `vehicledeal_docs.xsd`, `vehicle-titles-demo-checklist.xml`, the manifest's `Nuxeo-Component`, `content-model.json`'s schema and the type's entry                                                                                                                                         | `npm run app-package` passed after it: 2 layouts held to the model, 4 files                                                                                                                                             |
| `apply_package_changes`, 4 changes: `app-model` for `vtitles_deals_missing_documents`, on the checklist; `app-queue` three times                                                                                                                                                                                                        | `written: true`, 6 files, in 4.2 seconds, with **one warning**: no Properties heading for `vehicledeal_docs`, which the next write gave                                                                                 |
| `apply_package_changes`, 2 changes: `app-model` for `VehicleDeal` again, `force`, `year` as text; `app-model` for `vtitles_deals_missing_documents` again, `force`, sold deals only                                                                                                                                                     | `written: true`, 3 files, in 3.2 seconds. **It dropped `vehicledeal_docs` from the type's entry in `content-model.json`,** as the onboarding kit's item 4 says; put back by hand                                        |
| `apply_package_changes`, 9 changes: `labels/en.json` first, the two record pages, the three queues, `home.json` and `navigation.json`, whole, then `app-registry`                                                                                                                                                                       | `written: true`, 9 files, in 1.0 second, no warning: 9 files passed. `app-registry`: "Now names: home.json, navigation.json"                                                                                            |
| `write_package_file`, on purpose: the documents checklist on `vdocs:checklists`                                                                                                                                                                                                                                                         | **Refused:** step 2, `cards[6].checklist.field: "vdocs:checklists" is not a property of the type "VehicleDeal" or of its facets` [unknown]                                                                              |
| `write_package_file`, on purpose: the capture looked up by `vdeal:price` as well                                                                                                                                                                                                                                                        | **Refused:** step 2, `capture.findBy[1]: a capture looks a number up in a text, and "vdeal:price" is a double property` [parameter]                                                                                     |
| `write_package_file`, on purpose: the lien release queue with a third facet, `vtitle_clerk_agg`                                                                                                                                                                                                                                         | **Refused:** step 2, `facets[2].aggregate`: the page provider "has no aggregate "vtitle_clerk_agg": it defines vtitle_lienHolder_agg, vtitle_issuingState_agg" [unknown]. Both files' SHA-256 unchanged after the three |

**What was written by hand, and why.** The skill says never to write a model component by hand. But
`app-model` writes no complex property, and a checklist card needs one in a fixed shape: the
request's tickable checklist could not be written otherwise (feedback, item 2). So, as the
onboarding kit did, in a component of its own that `app-model` never writes, so that it may write
its own again:

- **the checklist's schema,** `vehicledeal_docs.xsd`, and **its component,**
  `vehicle-titles-demo-checklist.xml`, which requires the model component and appends the schema to
  `VehicleDeal`;
- **the manifest,** to list that component between the model's and the configuration's (item 3);
- **`content-model.json`'s entries for it,** the schema and the type's list, so that the pipeline
  and the write tools hold the checklist cards to the property's shape. Written again after the
  third write's `app-model --properties --force`, which wrote the type's entry from scratch (item 4).

The pipeline passed the package after each hand edit, and every write after them held the layouts
to the hand-written entries: the first refusal above is the checklist's property found misspelt.

The edits, written with `write_package_file` from layout-v2.md and app-definition-v2.md, each file
the designer's bytes for its value:

- **The deal page,** from the generator's one card of 26 fields: the deal, the buyer, the vehicle,
  the price and finance, the trade-in, the title, the two checklists, the attachments, notes and
  history. Widgets a person would pick: `status-badge` with a tone for each status and finance type,
  `currency` in USD, `date`, `user`, `email`, `phone`, `number`, `long-text`, `file-list`, and
  `document-link` with `types: ["VehicleTitle"]` for the two titles, with `show` for the title's
  number, state, status and lien holder and the trade-in title's status and lien holder, which the
  generator could not choose. The lender, the amount financed and the term show for a loan or a
  lease only, the trade-in card when the deal has one, the days since the sale while it is sold
  and not delivered.
- **The checklists,** two cards over the one property, `vdocs:checklist`, each `tickable`: the six
  documents every deal needs, and the three a loan or a lease needs, that card shown for those
  only. A tick on either writes the whole list, as the card does, and keeps the other card's
  entries.
- **The capture,** `files:files` found by `vdeal:number` or `vdeal:vin`.
- **The banners,** each a registered rule: cancelled, `app.rules.fieldIn`; not funded,
  `core.every` of `fieldIn` `Contracted`, `fieldIn` `Loan` or `Lease` and
  `app.rules.dateAfter` `["today", { "field": "vdeal:soldOn" }, 10]`. On the title: overdue,
  `core.every` of `dateAfter` `["today", { "field": "vtitle:openedOn" }, 30]` and `core.not` of
  `fieldIn` `Issued`; awaiting lien release, `fieldIn`.
- **The title page:** the title, the vehicle, the lien with the days since the payoff
  (`core.dateDiff`), the title work with its days open, its deals sold and taken in trade as two
  related lists given its `ecm:uuid`, notes and history.
- **The queues' widgets and facets,** the title status column through `show`, the home and the menu,
  which have no generator; the lien release queue, its menu entry and its figure for title clerks
  alike.

### Step 3. Check them: every write already did (01:05, 2 minutes)

| Check                                                                                                                                                                                                                                                    | Result                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run app-package -- business-apps/packages/vehicle-titles-demo --platform 0.2.0 --model business-apps/packages/vehicle-titles-demo/content-model.json`                                                                                               | Passed: 2 layouts held to the model, 9 files passed, sha256 `7d1d34c7…aea6f`, the last write's                                                                                                                                     |
| `validate_package`                                                                                                                                                                                                                                       | `passed: true`, `asCi: true`, no finding, the same SHA-256: the same check again, as the MCP server runs it                                                                                                                        |
| By hand, what the pipeline does not check (skill, step 3): every property a field, a column, a sort, a rule, a computation, a checklist, the capture, a `show` or a page provider's NXQL names, against its type, its page provider's or the linked type | 134 references, none missing. Seen failing, on a copy: `vtitle:openOn` in the overdue banner's rule, `vdeal:buyerName` in a related list and `vdocs:checklist/*/don` in the NXQL, all three named                                  |
| The pipeline on that broken copy                                                                                                                                                                                                                         | **Refused the related list's column,** and, that put right, **passed the rule and the NXQL:** a banner whose rule names a property the type does not have never shows, and a query naming one fails on a server (feedback, item 8) |

### Step 4. Preview in dev mode, as far as it goes (01:07, 1 minute)

| What                                     | Result                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `preview_package`, no dev server running | `served: true`: the home, the menu, the three queues, the labels, the two layouts; `app.json` not served, as the registry's. `devServer.answering: false`, "Nothing answered at http://localhost:4200" |
| The dev server and the pages             | **Not started, not seen.** The person signs in to the app with their own account, and this run had none; and no server holds a `VehicleDeal` or a `VehicleTitle`                                       |

What a browser would show is what the other kits' runs saw for a kit no server has: the home's
figures "Unavailable" and each queue's error state, since the server has none of the five page
providers. The pages to open are `#/home`, `#/queues/vehicle-deals-missing-documents`,
`#/queues/vehicle-titles-overdue` and `#/queues/vehicle-titles-awaiting-lien-release`. The layouts
are held instead by the layout designer's round trip, which opens each, and by the pipeline.

### Step 5. Publish to pre-production

**Not done, and not built in the MCP server.** No `app-package/*` tag was pushed. The kit is not
installed anywhere.

### The seed (01:08 to 01:19, 11 minutes)

Written by hand: the write tools refuse `demo/*`, as code. On the P&C claims kit's seed. Its
controls, `node business-apps/packages/vehicle-titles-demo/demo/seed.selftest.mjs`, **46 of 46
passed**. Broken on purpose eighteen ways, one at a time, in a scratch copy, each turned at least
one control red: no type precondition, no checklist schema precondition, no check that `/me`
answers a user, a deal linked to its title by number instead of id, the checklist written on
create only, a deal's attachments written over, no wait for the search index, no check of the
facets, no order check, a record listed twice not seen, the Basic header printed, no parameter
given to a title's deals, any trashed name like a record's restored, no write over an existing
record, an empty note not emptied, a missing document written with no entry, the overdue queue's
NXQL one day off the banner (`NOW('-P30D')`), and the finance checklist card shown for a cash deal
too. The first run found a defect in the data, before any of these: a deal's summary and its title's
number were both `title`, so one replaced the other; the summary is `summary` now.

### The lists of kits, and the release candidate (01:16 to 01:50)

- **The two lists of kits.** `npm run app-definition:server-validator` rebuilt the server
  validator's parity corpus with the kit, and the administrator guide has its rows: section 1's
  table of packages, the table of the app registry's groups, the README's link, the seeds that
  create no group, and the seeded workspaces. `kit-lists.spec.ts` passed, and failed with the
  corpus as staging had it and with the groups row removed, naming the kit each time. The kit was
  added to the lists of kits found in `kit-lists.spec.ts` and `kit-schema-labels.spec.ts`, which
  passed, and failed with `layout.schema.vehicledeal_docs` removed.
- **The designer's round trip,** `round-trip.spec.ts` and `round-trip.pages.spec.ts`, holds the
  kit's five files, each byte for byte. Seen failing with one queue's sort written across six lines,
  as `app-queue` writes it, and put back.
- **`npm run app-package:selftest`:** 124 negative controls refused and 37 sound packages built.
- **The release candidate,** `node scripts/release-candidate.mjs --out /tmp/vt-agent/rc-1 --since origin/staging/enterprise-grade-app --unsigned-kits`:
  RELEASE_CANDIDATE_RESULT

### The gate, the pre-PR review and the independent review

GATE_RESULT

## Building it

```bash
npm run app-package -- business-apps/packages/vehicle-titles-demo --platform 0.2.0
```

It writes `dist/vehicle-titles-demo-0.1.0.zip`, held to the package's own `content-model.json`,
since it ships a stand-in model: sha256 `7d1d34c7…aea6f` for 0.1.0, on 27 November 2026.

## Installing it on a local Nuxeo

**Not run.** Installing is a person's. Written from the P&C claims kit's install, which follows the
Payers kit's, the one that ran on the same container: the local Nuxeo is the Docker container
`nuxeo`, on port 8080, with `nuxeo-agentic-ui` already installed.

**1. Build it,** as above. **2. Copy it into the container,** then a one-off script that installs
it when the container next starts, and removes itself: `nuxeoctl mp-install` refuses while the
server runs, and the server is the container's main process.

```bash
docker cp business-apps/packages/vehicle-titles-demo/dist/vehicle-titles-demo-0.1.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/vehicle-titles-demo-0.1.0.zip --accept=true > /var/log/nuxeo/vehicle-titles-kit-install.log 2>&1 || echo "vehicle titles kit: install failed, see /var/log/nuxeo/vehicle-titles-kit-install.log"' 'rm -f "$0"' > /tmp/zz-vehicle-titles-kit-install.sh && chmod 755 /tmp/zz-vehicle-titles-kit-install.sh
```

```bash
docker cp /tmp/zz-vehicle-titles-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it.**

- `/var/log/nuxeo/vehicle-titles-kit-install.log` lists the package installed, and the server log's
  `Component Loading Status` has nothing pending or missing: three components,
  `nuxeo.config.vehicle-titles-demo.model`, `.checklist` and the configuration one.
- `/nuxeo/agentic-ui-config/layouts.json` lists `VehicleDeal` and `VehicleTitle` in `view` mode.
- The MCP server's `describe_document_type` `VehicleDeal` lists `files:files` and
  `vdocs:checklist`, and `describe_page_provider` `vtitles_awaiting_lien_release` its two
  aggregates, from the server.
- **Run the two queries nothing here has run,** read-only, as searches:
  `SELECT * FROM VehicleDeal WHERE vdocs:checklist/*/done = 0` and
  `SELECT * FROM VehicleTitle WHERE vtitle:openedOn < NOW('-P31D')`. Then the seed checks the page
  providers against what it wrote.
- The content model the server answers is `content-model.json`'s:

  ```bash
  npm run app-package:model -- --server http://localhost:8080/nuxeo --out tmp/vehicle-titles-model.json
  ```

  ```bash
  npm run app-package -- business-apps/packages/vehicle-titles-demo --platform 0.2.0 --model tmp/vehicle-titles-model.json
  ```

### Removing it

**Not run.** **First delete the seeded workspace,** `/default-domain/workspaces/vehicle-titles-demo`,
and empty it from the trash: a document whose type is gone cannot be read. Then a one-off script,
as for the install, with `nuxeoctl mp-remove vehicle-titles-demo --accept=true`.

## Seeding it

With the package installed and Nuxeo running, from the repository's root:

```bash
export NUXEO_USER=<administrator> NUXEO_PASS=<password>
```

```bash
node business-apps/packages/vehicle-titles-demo/demo/seed.mjs
```

- **What it writes:** eight titles and eight deals, under
  `/default-domain/workspaces/vehicle-titles-demo`, in `titles` and `deals`, each named by its
  number. Dates are counted from the UTC day it runs, so the queues and banners hold the same
  records whichever day that is:
  - **deals missing documents:** VD-5002 (delivered, its odometer statement not in), VD-5004
    (contracted, its title application, delivery receipt and lender's approval not in) and VD-5008
    (funded, its proof of insurance not in), oldest sale first. Not VD-5001, VD-5003 or VD-5005,
    every document in; nor VD-5006, still worked, or VD-5007, cancelled, though both lack some;
  - **titles overdue:** TTL-6002 (open 40 days), TTL-6004 (34) and TTL-6008 (31), the longest open
    first. Not TTL-6007, open 30 days exactly, nor TTL-6005, issued;
  - **titles awaiting lien release:** TTL-6004, its payoff sent 30 days ago, and TTL-6003, 18 days
    ago. Lien holder: one each for `Larkspur Credit Union` and `Harrow Valley Bank`; State: one each
    for `Oregon` and `Washington`;
  - **VD-5004 is financed, contracted 14 days ago and not funded,** so its page shows the warning,
    and it has a trade-in whose title, TTL-6004, waits for its lien release;
  - **TTL-6002's vehicle was sold twice:** VD-5007, unwound, and VD-5002, so its page lists both; it
    is VD-5002's title, and TTL-6003 the title VD-5002 took in trade;
  - **TTL-6008 was bought at auction and sold since,** VD-5008, without its title: overdue.
- **No user and no group.** The kit's groups and the people in them are the server's to decide. The
  salespeople, finance manager and clerks are user names only, so the `user` widget shows the name
  as stored.
- **Links are ids,** written in order: the titles, then the deals with their titles' ids.
- **The checklist is written whole every run:** an entry for each document the deal's cards list,
  done with who and when, or not done. **A tick made in a demo is undone by the next run,** so the
  demo can be given again.
- **It never writes a deal's attachments.**
- **Safe to run twice,** as the P&C claims kit's seed: a record already there is put back to
  `data.mjs`'s values, a property the data leaves empty emptied, a trashed one restored and put
  back, a trashed document whose name only looks like a record's left in the trash, two trashed
  copies of one stop the run, and a place holding a document of another type stops the run,
  untouched.
- **It checks what it wrote:** the five page providers must return every seeded record that
  belongs in them and none that does not, in their order and once each, the title's deals given
  each title's id; the titles awaiting lien release are asked again until the search index agrees,
  up to `NUXEO_INDEX_WAIT_MS` (15 seconds by default), and their two facets must count at least the
  seeded titles.
- **What it needs:** Node 24, nothing to install. `NUXEO_USER` and `NUXEO_PASS` have no default.
  `NUXEO_URL` defaults to `http://localhost:8080`. Exit 2 means a precondition is not met, before
  anything is written: no credentials, no server, or one that answers `/me` with an error, with
  something that is not JSON, or with no user, credentials refused, either type missing, the deal's
  checklist schema missing, or no `/default-domain/workspaces`.
- **Its controls** run it against a stand-in for the REST API: they prove the script, not the
  server. CI does not run them. 46 controls, each behaviour above among them, one that no run prints
  a password or its Basic header, and six on the data as the pages read it: the overdue banner and
  queue agreeing, the checklist cards listing the documents each deal has an entry for, and the
  records this README names.

It prints the home, the three queues, the deal missing its odometer statement, the deal not funded
and the title sold twice, on the app at `APP_URL` (`http://localhost:4200` by default).

## What a server shows, and what the dev server does

| Part                         | Served by the package on a server    | Under `config:dev`                    |
| ---------------------------- | ------------------------------------ | ------------------------------------- |
| The model and page providers | Yes                                  | From the server, so not yet           |
| The two layouts              | Yes, to everyone                     | Yes                                   |
| The home, menu, queues       | From the registry, to the two groups | Yes, and they win over the registry's |
| `labels/en.json`             | From the registry, to the two groups | Yes, and it wins over the registry's  |
| `app.json`                   | From the registry: it lists the app  | No                                    |

Seeing an app is not a security control: Nuxeo's permissions still decide which deals and titles
anyone reads and who may tick a checklist, and the seed sets none, so its workspace has the
server's defaults. A hidden card, banner or queue hides nothing from the REST API.

## Phase 8 feedback: where the tools fell short

What the build met, in the order it met it. **Nothing was changed outside the kit** but the lists
of kits the skill says to join, and two specs' lists of kits found; each item is a follow-up
candidate for the tools' owners.

1. **Step 1 has no account, and the agent's own client was refused while it passed its whole
   environment to the server.** The repository connects no agent to the MCP server without
   registering it in the person's Claude configuration (the moves kit's item 14, the P&C claims
   kit's 15, still), so each run writes its own client, and this run's first one gave the server
   every variable the shell had, a token among them; the session's permission system refused it.
   Given only what Node needs, it ran. Candidate: a client in the repository, as
   `tools/builder-mcp/src/testing/client.ts` is for the specs, that starts the server with the
   credentials it needs and nothing else.
2. **`app-model` writes no complex property,** so no checklist, which layout version 2's checklist
   card needs in a fixed shape (the onboarding kit's item 1, still). Kit-blocking: the schema and its
   component were written by hand. Candidate: a `checklist` property type for `app-model`.
3. **The write tools do not write the manifest,** so a hand-written component is listed by hand
   (the onboarding kit's item 5, still).
4. **`app-model --properties --force` writes a type's `content-model.json` entry from scratch,**
   dropping a schema added to it (the onboarding kit's item 4, still): seen here, and put back by
   hand.
5. **A number shows grouped, and no widget says otherwise:** a model year stored as a `long` shows
   as "2,024", with or without `number`, whose only parameter is `decimals`. The year is text.
   Candidate: `number` with a `grouping` parameter.
6. **No query says "not every item done", and nothing writes a checklist's entries but a tick:** the
   items are the layout's, so a page provider can find a deal with an entry not done, never one
   lacking an entry. The queue depends on every deal carrying an entry per document, which only the
   seed writes. Candidates: the checklist card writing the record's missing entries, not done, on
   its first tick; or a count of items done that the platform keeps on the record for queries.
7. **Nothing runs a package's NXQL before a server does.** `vdocs:checklist/*/done = 0`, a boolean
   in a list's subfield, and `NOW('-P31D')` passed the token check and are run nowhere yet; the
   moves kit's run found `BETWEEN NOW(...)` refused only by a query (its item 12). Candidate: a
   read-only run of each of a kit's page providers in step 1, when the server can be read.
8. **The pipeline does not check the properties a rule or a page provider's NXQL names,** even
   against a demo kit's own model: `vtitle:openOn` in the overdue banner and `vdocs:checklist/*/don`
   in the queue's query both passed it (the P&C claims kit's item 5, for rules, still). Candidate:
   both held to the model where it is known, as columns and `show` are.
9. **A queue and a banner say one thing twice:** "more than 30 days open" is `NOW('-P31D')` in the
   page provider and `dateAfter` 30 in the rule, and only the kit's own control holds them
   together. Candidate: a queue that filters a page provider's records by a registered rule, or a
   note in layout-v2.md on writing the two to agree.
10. **A rule reads the open record only,** so the deal page cannot warn that its title is overdue
    or awaiting a lien release (layout-v2.md, section 5); it shows the title's status as text
    through `show`, which gives the shown value no widget (section 12), so not as a badge.
11. **Two checklist cards over one property are not described:** layout-v2.md's section 7 has one
    card per property, and nothing says whether a record page with two writes each tick from the
    same copy. The validator passes it; no browser saw it here.
12. **The scaffolded README still offers a button** (`app-action`) for a package with none (the
    moves kit's item 13, the P&C claims kit's 16, still).
13. **Dev mode shows a demo kit's shell, not its pages** (the tutorial's item 8, still), and the
    preview needs a person signed in: no page of this kit was seen.
14. **What went well:** every write answered with its files and the pipeline's own lines in 1 to 7
    seconds; each refusal named the file, the place and the reason and left the package as it was;
    the demo-kit order worked first time in one call of 9 changes; a missing Properties heading came
    back as a warning on the write that caused it; the capture's `findBy` was held to text
    properties at write time; and `dateAfter` with `"today"`, `show` and the tickable checklist,
    each another kit's feedback, carried the request's overdue titles, the deal's title and its
    documents with no Angular code.

## Decided without the user

Each reversible, each the agent's recommendation:

- **The names:** the types `VehicleDeal` and `VehicleTitle`, the prefixes `vdeal`, `vtitle` and
  `vdocs`; the app id and address `vehicle-titles`; the groups `vehicle-deal-desk` and
  `vehicle-title-clerks`; the queue ids beginning `vehicle-` and the page providers `vtitles_`, so
  that none meets another kit's.
- **The link's direction:** a deal names its title and its trade-in's title by id; a title lists
  its deals in two related lists, sold and taken in trade.
- **The statuses** above, and "sold" as `Contracted`, `Funded` or `Delivered`.
- **The required documents:** six for every deal, three more for a loan or a lease in a second card
  over the same checklist.
- **"Missing documents"** as a sold deal with an entry not done; **"overdue"** as more than 30 days
  since the title work opened and not issued.
- **The lien release queue, its menu entry and its home figure for title clerks only,** and the rest
  for everyone. Hiding a queue is not a security control.
- **No Edit form, no `actions.json`, no `external` card:** none was asked for, and no other system's
  data was. The title's lien is the record's.
- **The model year as text,** for the grouping above.
- **The seed puts a deal's checklist back every run,** undoing a demo's ticks.
- **Banners not asked for:** a cancelled deal, a financed deal not funded 10 days after the sale,
  and a title awaiting its lien release.
- **The capture finds a deal by its number or its VIN,** and keeps no location.

## Not done yet

- **Installing, seeding and the live pages:** a person's.
- **The two queries no server has run** (feedback, item 7).
- **The photo from a phone on a server:** the capture page files it, and has been run against a
  stand-in of the server only.
- **The salespeople, finance manager and clerks are names, not people.**
- **The Properties panel beside the record page** is version 1's generated one; a `metadata` layout
  would order it.
- **`content-model.json` is `app-model`'s and the hand edits',** until it is exported from a server
  with the package installed.
