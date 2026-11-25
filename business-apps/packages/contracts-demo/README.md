# Contracts (demo)

A second business app, built the way phase 3's demo builds one
([development plan](../../../docs/business-apps/development-plan.md), phase 3): an agent, asked for
a contracts app, took the app builder skill's steps
([`.cursor/skills/app-builder/SKILL.md`](../../../.cursor/skills/app-builder/SKILL.md)) in order,
with the generators, the package pipeline and the Builder MCP server, and wrote by hand what they
do not write, where the skill says not to as well. Every name in it is fictional. The log of each
step, its result and each departure is [below](#how-it-was-built-the-log).

## The short version

- **A contract record page,** and an edit form with the field rule asked for in plain words: "the
  termination reason is required when the status is Terminated".
- **A queue,** "Up for renewal or overdue": active contracts that end within 90 days, or have
  ended and are still active, soonest first. Named so since 0.2.1: under "Up for renewal" alone, a
  browser walkthrough found CTR-1007, ended ten days before, and flagged it. The ended
  ones are there on purpose, first, and the record page tells the two apart with its banners.
- **A home, a menu and labels:** the renewals figure, which links to the queue, for everyone the
  app is for; the active contracts for contract managers; the terminated ones for legal reviewers.
- **An `app.json` that names its own groups,** `contract-managers` and `legal-reviewers`, and a
  component that contributes the app to the app registry, so a server with the package installed
  lists it beside the Payers app to a person in a group of each. Its address is `contract-desk`,
  since its id, `contracts`, is a platform route.
- **A stand-in model, in its own component:** the `Contract` type, its `contract` schema and three
  page providers. It is fictional, and replaced whole when a real one comes.
- **A seed script,** with its controls, which writes seven fictional contracts. It creates no user
  and no group.
- **Not installed anywhere yet.** The package passes the pipeline; installing it and seeding it are
  for the person who reviews it ([below](#installing-it-on-a-local-nuxeo)).

## What is in it

| File                                                         | What it is                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `bundle/agentic-ui-config/app.json`                          | The app: id `contracts`, address `contract-desk`, its name, version, platform range and two groups |
| `bundle/agentic-ui-config/layouts/Contract/view.layout.json` | The Contract record page: three banners, four cards and the history                                |
| `bundle/agentic-ui-config/layouts/Contract/edit.layout.json` | The Edit form, with the field rule and a check that the end is not before the start                |
| `bundle/agentic-ui-config/queues/up-for-renewal.json`        | The renewals queue                                                                                 |
| `bundle/agentic-ui-config/home.json`                         | The home: three figures, one for everyone and one for each group                                   |
| `bundle/agentic-ui-config/navigation.json`                   | The menu: the home and the queue                                                                   |
| `bundle/agentic-ui-config/labels/en.json`                    | Its labels, in English: every key the files above name                                             |
| `bundle/OSGI-INF/contracts-demo-config.xml`                  | The component that contributes the two layouts and the app                                         |
| `bundle/OSGI-INF/contracts-demo-model.xml`                   | **The stand-in model:** the document type, its lifecycle, three page providers                     |
| `bundle/schemas/contract.xsd`                                | **The stand-in model's** schema                                                                    |
| `content-model.json`                                         | The model as the server would answer it, for `--model` (below)                                     |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/seed.selftest.mjs`   | The seed script, its fictional contracts, and its controls. Not packaged                           |
| `package/package.xml`                                        | The Marketplace package: name, version, and what it depends on                                     |
| `build.mjs`                                                  | Version 1's builder: the generator's, byte for byte                                                |

- **No `actions.json`.** Nothing in the app reads one yet, and none was asked for.
- **No bootstrap fragment.** On a shared server it would rebrand everyone's app.
- **One version in three places:** 0.2.1, in `package.xml`, `app.json`'s `packageVersion` and the
  manifest's `Bundle-Version`.
- **Its address is `contract-desk`,** not its id: `contracts` is the platform's own page,
  `/contracts`, the component showcase (`PLATFORM_ROUTES` in `libs/shared/app-definition`). 0.1.0
  had no address, so the pipeline noted the clash; 0.2.0 gives one, and a changed address is a
  breaking change, a minor below 1.0.0 (package-pipeline.md, section 8). It also needs a migration
  note, which the upgrade check asks for (section 10): `upgrade-notes.json` says that a link to the
  old address names `contract-desk` instead.

## The stand-in model

The local Nuxeo has no contracts model, and none was given, so the package carries a fictional
one, as the Payers kit does, in a component of its own so that it can be replaced whole:
`contracts-demo-model.xml` and `bundle/schemas/`.

| Type       | Schema (prefix)         | What it holds                                                                                                                                                                      |
| ---------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Contract` | `contract` (`contract`) | `number`, `counterparty`, `category`, `status`, `value`, `currency`, `start`, `end`, `noticeDays`, `autoRenew`, `owner`, `terminationReason`, `notes`. Its title is its `dc:title` |

- **The status is a property,** `contract:status`: `Draft`, `Active`, `Terminated` or `Expired`,
  stored as those words, so that the page shows them as they are and the field rule names
  `Terminated` as the request did. `category` is `Services`, `Supply`, `Licence`, `Lease` or
  `NDA`. The type has the platform's default lifecycle, which nothing here reads.
- **`currency` holds an ISO 4217 code,** which the `currency` widget reads from the record.
- **Not a folder, and holds no file,** so a contract opens as a record page. No folder lists the
  type among its subtypes, so the Create menu does not offer it: the seed writes the records.
- **The names are plain:** `Contract`, `contract`. On a server shared with another model that uses
  them, the two would collide. A real model sets the real ones.

| Page provider              | Given   | Returns                                                                             |
| -------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `contracts_up_for_renewal` | Nothing | Active contracts whose end is no more than 90 days away, or past, soonest end first |
| `contracts_active`         | Nothing | Active contracts                                                                    |
| `contracts_terminated`     | Nothing | Terminated contracts, latest change first                                           |

- **All three read the repository,** so they list a write at once, and none has an aggregate: the
  queue has no facet, and the home's figures are counts.
- **"90 days" is said twice:** in the page provider, as NXQL's `NOW('P90D')`, and in the record
  page's banner, as `app.rules.dateWithin`. Change both together. On the 90th day itself they can
  disagree: the query reads the server's clock, the banner the reader's day.
- **Each leaves out versions, proxies and trashed records.**

`content-model.json` is that model as a server with the package installed would answer
`npm run app-package:model`: `common` and `dublincore` exactly as the local Nuxeo's export
answered them on 24 November 2026, and the `Contract` type and `contract` schema written in the
export's shape from `contract.xsd`, since no server has the package yet. Export it again once one
does, cut it down to the type and its three schemas, and compare (below).

## How it was built: the log

Run on 24 November 2026, in a checkout of `staging/enterprise-grade-app`, on Node 24.22.1, against
the local Docker Nuxeo (2025.10.18, which has the Satori package and the Payers kit installed),
signed in with its default administrator account from the environment. The agent spoke to the
Builder MCP server over stdio, as Claude Code does once the server is registered, with a client
of its own outside the repository: registering it with `claude mcp add-json` changes the person's
own Claude configuration, which was not asked for.

### Step 0. Before you start

| What                               | Result                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `npm ci`                           | Passed. `package-lock.json` unchanged                                  |
| `NUXEO_USER`, `NUXEO_PASS`         | Exported in the shell only; never written to a file, a commit or a URL |
| A server whose model may be shared | The local Docker Nuxeo, which holds fictional records only             |

### Step 1. Read the server

| Asked                                                        | Answer                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `get_content_model`                                          | 66 types, 65 facets, 104 schemas. No `Contract` type, and no schema prefixed `contract`               |
| `describe_document_type` `Contract`                          | Refused: "The server has no document type "Contract""                                                 |
| `describe_page_provider` `contracts_up_for_renewal`          | Refused: the server has no such page provider                                                         |
| `list_page_providers`, `list_vocabularies`, `list_workflows` | 103 page providers, the stock vocabularies, and the two stock review workflows: nothing for contracts |
| A read-only NXQL query with `NOW('P90D')`                    | Accepted: this Nuxeo's NXQL takes a duration in `NOW()`, which the renewals page provider uses        |
| `npm run app-package:model`, to `/tmp`                       | 66 types, 65 facets and 104 schemas, outside the repository                                           |

**The skill says to stop here:** the type the person names must exist, and creating it is
Studio's. The request asked for a stand-in model instead, as the Payers kit carries one, so the
agent wrote one, kept apart in its own component, and wrote its content model in the export's
shape for the generators to read.

### Step 2. Write the files, with the generators

| Command                                                                                                                                                                                                                                                                                                    | Result                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx g ./tools/satori-generators:app-package contracts-demo --owner=nuxeo --appId=contracts --title="Contracts" --vendor="Nuxeo" --groups=contract-managers,legal-reviewers --type=Contract --model=/tmp/contracts-kit/content-model.json`                                                              | `app.json`, `labels/en.json`, the component, `package/`, the manifest, `build.mjs`, and the record page: one card, `contract`, with all 13 properties in the model's order. Left out: nothing |
| `npx nx g ./tools/satori-generators:app-queue --package=business-apps/packages/contracts-demo --id=up-for-renewal --pageProvider=contracts_up_for_renewal --columns=contract:number,dc:title,contract:counterparty,contract:end,contract:value --sort=contract:end --pageSize=50 --label="Up for renewal"` | `queues/up-for-renewal.json` and its label. It said to check the page provider with `describe_page_provider`, which had already said the server has none                                      |

Run today, the first command is refused: `app-package` now refuses an id that is a platform route
unless `--address` gives another, so it needs `--address=contract-desk`, the address 0.2.0 gives.

Then by hand. The skill says to write the menu and the home by hand, and to edit what the
generators wrote; it also says never to write the manifest or the component by hand, and both were,
because no generator wrote the edit layout's entry, the `<app>` element or a second component then
(phase 3 feedback, below). They do now: `app-form` writes an Edit form and its `<layout>`,
`app-package` and `app-registry` the `<app>` element, and `app-model` a stand-in model in a
component of its own that the manifest lists. What follows is what was written by hand then:

- **The record page,** from the generator's one card: four cards in a person's order (the contract,
  its terms, its termination, its notes) and the history; `status-badge` with a tone for each
  status, `currency` reading its code from `contract:currency`, `date`, `user`, `long-text`; a
  computed term in months (`core.dateDiff`); and three banners: up for renewal
  (`app.rules.dateWithin`, 90 days), ended and still active (`app.rules.datePassed`), and
  terminated. The Termination card shows only while the status is `Terminated`.
- **The field rule, from the plain words** "the termination reason is required when the status is
  Terminated": `required` is for forms only (layout-v2.md, section 2), so it went into an edit
  layout, `layouts/Contract/edit.layout.json`, on `contract:terminationReason`, as
  `{ "type": "app.rules.fieldIn", "parameters": [{ "field": "contract:status" }, "Terminated"] }`.
  `app.rules.fieldIn` is registered (`PACKAGED_REGISTRIES`), so no rule was invented. The form also
  requires the number, the title and the status, and checks that the end is not before the start
  (`core.notBefore`).
- **The queue's widgets:** `relative-date` on the end, `currency` from the record's code, `user`.
- **The home and the menu,** which have no generator, from app-definition-v2.md, sections 9 and 10.
- **The component:** the edit layout's `<layout>`, and the `<app>` element, which the `app-package`
  generator did not write then, naming the four files the registry serves. `app-registry`, run on
  0.2.0, finds it naming every file already.
- **The stand-in model:** `contracts-demo-model.xml`, `contract.xsd`, and the model component
  added to the manifest's `Nuxeo-Component`.

### Step 3. Check them, after every write

| When                                       | Check                                                                                        | Result                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| After `app-package`                        | `npm run app-package -- <kit> --platform 0.2.0 --model <model>`                              | Passed, 3 files, 1 layout held to the model, and a note: "no component contributes the app, so the app registry will not serve it"                                                              |
| After the hand edits, before the component | The same                                                                                     | Passed, 7 files, 2 layouts held to the model. **The edit layout was not contributed yet, and nothing said so** (phase 3 feedback, below)                                                        |
| After the component                        | The same, and without `--model`                                                              | Both passed, 7 files; the note about the app gone. Same SHA-256 each way                                                                                                                        |
| After the component                        | `validate_package`, the CI view                                                              | `passed: true`, `asCi: true`, no finding, the same SHA-256                                                                                                                                      |
| After the component                        | By hand, what the pipeline does not check (skill, step 3)                                    | Every property the queue and the two layouts name, in a field, a column, a sort, a rule, a computation, a check or a widget parameter, is the model's `Contract`'s: 47 references, none missing |
| After the stand-in model                   | Each page provider's query, run read-only with stock properties in place of `contract:` ones | Each answered 200: the NXQL is well formed. The `contract:` properties themselves wait for an install                                                                                           |
| After the seed                             | `node business-apps/packages/contracts-demo/demo/seed.selftest.mjs`                          | 23 of 23 controls passed. Broken on purpose nine ways, one at a time, each turned at least one control red (below)                                                                              |

**An agent asked to use an unregistered ID is refused.** The agent was asked to write the field rule
with `app.rules.statusIs`, which reads well and is not registered. The edit layout's
`contract:terminationReason` was given
`"required": { "type": "app.rules.statusIs", "parameters": ["Terminated"] }`, and:

- `npm run app-package -- business-apps/packages/contracts-demo --platform 0.2.0 --model business-apps/packages/contracts-demo/content-model.json`
  exited 1 at step 2, with no zip left in `dist/`:

  ```text
  business-apps/packages/contracts-demo/bundle/agentic-ui-config/layouts/Contract/edit.layout.json: cards[0].fields[5].required: the rule "app.rules.statusIs" is not registered [unknown]
  2 layouts were held to the content model in business-apps/packages/contracts-demo/content-model.json.
  7 files: 6 passed, 1 refused.
  business-apps/packages/contracts-demo: step 2 refused it: the app definition has findings, listed above.
  ```

- `validate_package` answered `passed: false`, `refusedAt.step: 2`, and one finding:
  `layouts/Contract/edit.layout.json`, `cards[0].fields[5].required`,
  `the rule "app.rules.statusIs" is not registered`, kind `unknown`.

Then the registered rule was put back, `app.rules.statusIs` appears nowhere in the kit's files
but this README, and the
pipeline passed again with the SHA-256 it had before.

### Step 4. Preview in dev mode, as far as it goes

| What                                                                     | Result                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview_package`, `DEV_SERVER_URL=http://localhost:4299`, no dev server | `served: true`: the home, the labels, both layouts, the menu and the queue written to the dev folder; `app.json` not served, as the registry's. `devServer.answering: false`, ECONNREFUSED                                                                                  |
| `npx nx serve nuxeo-ui --port 4299`, started after the folder existed    | Up                                                                                                                                                                                                                                                                          |
| `preview_package` again                                                  | `served: true`; `devServer`: "answers every file as the dev folder holds it"                                                                                                                                                                                                |
| `#/home`, signed in                                                      | **Drawn from the kit's files:** the title "Contracts" and the "Up for renewal" card with "Open the queue". Its figure says "Unavailable": the server has no `contracts_up_for_renewal` (HTTP 500). The two group cards are hidden, as the administrator is in neither group |
| The menu                                                                 | The kit's two entries, "Home" and "Up for renewal", after the platform's                                                                                                                                                                                                    |
| `#/queues/up-for-renewal`                                                | **Drawn from the kit's file,** under its name, "Up for renewal"; the list says the server could not complete the request: the same missing page provider                                                                                                                    |
| The Contract record page                                                 | **Not shown live:** no server holds a `Contract`. Drawn instead, not live, below                                                                                                                                                                                            |

**The record page and the form, drawn with stubbed answers: not live.** To see that the layouts draw
as written, the real app on the dev server was opened on three fictional contracts from `data.mjs`
(CTR-1001, CTR-1004, CTR-1007), with the browser answering, in place of the server, the record
itself and the `Contract` type and `contract` schema, built from `content-model.json`. Every other
read went to the local Nuxeo. The browser refused every write but a search's, so nothing was
written to the server, and the Edit form's check below sent no write to the stubbed record. Seen:

- CTR-1001: the warning banner "Up for renewal", the status as a green badge, the value as
  "$48,000.00" from its USD code, the term as 12 months, no Termination card;
- CTR-1004: the negative banner "terminated", the Termination card with its reason;
- CTR-1007: the negative banner "end date has passed, and it is still active", and not the renewal
  one;
- the Edit form on CTR-1001: Termination reason not required while the status is `Active`
  (`aria-required=false`); with the status typed `Terminated`, required (`aria-required=true`);
  Save refused, "1 field needs a correction before you can save", under the field "Termination
  reason is required.";
- the history card says it could not be loaded, and the contract manager shows the stored user
  name with "user avery.quinn not read: HTTP 404" in the console: the record and its users exist
  nowhere.

The screenshots are in `~/Desktop/agentic-ui-evidence/beta/contracts-demo/`, outside the
repository. Seeing all of this live needs the package installed and seeded, next.

### Step 5. Publish to pre-production

**Not done, and not built in the MCP server.** Signing and promotion are a proposal
([package-pipeline.md](../../../docs/business-apps/package-pipeline.md), section 9), and no
`app-package/*` tag was pushed.

## Building it

```bash
npm run app-package -- business-apps/packages/contracts-demo --platform 0.2.0
```

It writes `dist/contracts-demo-0.2.1.zip`, with no note. Held to its content model:

```bash
npm run app-package -- business-apps/packages/contracts-demo --platform 0.2.0 --model business-apps/packages/contracts-demo/content-model.json
```

Held to the version before, as CI holds a pull request to its base, with that version's copy in
`/tmp/base` (package-pipeline.md, section 8):

```bash
mkdir -p /tmp/base && git archive origin/staging/enterprise-grade-app business-apps/packages/contracts-demo | tar -x -C /tmp/base
```

```bash
npm run app-package -- business-apps/packages/contracts-demo --platform 0.2.0 --previous /tmp/base/business-apps/packages/contracts-demo
```

From 0.1.0 it writes `dist/contracts-demo-0.2.0.changes.md`: the address changed, which is
breaking, and the component, which is to judge, so 0.2.0, a minor. 0.1.1 is refused at step 3.
From 0.2.0, `dist/contracts-demo-0.2.1.changes.md`: 3 changes, the queue's and the home figure's
names changed and `layout.schema.contract`, the Properties panel's heading for the schema, added,
which need a patch.

## Installing it on a local Nuxeo

**Not run yet.** Written from the Payers kit's install, which ran on the same container: the local
Nuxeo is the Docker container `nuxeo`, on port 8080, with `nuxeo-agentic-ui` already installed, as
it was on 24 November 2026 (`/nuxeo/agentic-ui-apps/apps.json` answers there). On a server without
it, install it first, as the Payers kit's README, "Installing it on a local Nuxeo", step 1, says.

**1. Build it,** as above.

**2. Copy it into the container,** then a one-off script that installs it when the container next
starts, and removes itself. `nuxeoctl mp-install` refuses while the server runs, and the server is
the container's main process.

```bash
docker cp business-apps/packages/contracts-demo/dist/contracts-demo-0.2.1.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/contracts-demo-0.2.1.zip --accept=true > /var/log/nuxeo/contracts-kit-install.log 2>&1 || echo "contracts kit: install failed, see /var/log/nuxeo/contracts-kit-install.log"' 'rm -f "$0"' > /tmp/zz-contracts-kit-install.sh && chmod 755 /tmp/zz-contracts-kit-install.sh
```

```bash
docker cp /tmp/zz-contracts-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it.**

- `/var/log/nuxeo/contracts-kit-install.log` in the container lists the package installed, and the
  server log's `Component Loading Status` has nothing pending or missing.
- `/nuxeo/agentic-ui-config/layouts.json` lists `Contract` in `view` and `edit` mode, beside the
  Payers kit's layouts.
- The MCP server's `describe_document_type` `Contract` and `describe_page_provider`
  `contracts_up_for_renewal` answer, where step 1 above was refused.
- The content model the server answers is `content-model.json`'s. Export it, cut it to the kit's
  type and schemas, and compare; a difference is the hand-written part's to correct:

  ```bash
  npm run app-package:model -- --server http://localhost:8080/nuxeo --out /tmp/contracts-model.json
  ```

  ```bash
  npm run app-package -- business-apps/packages/contracts-demo --platform 0.2.0 --model /tmp/contracts-model.json
  ```

A rebuild of a version already installed is skipped as unchanged: in the one-off script, run
`nuxeoctl mp-remove contracts-demo --accept=true` before `mp-install`. Do the same on a server with
0.1.0 installed: remove `contracts-demo`, then install `contracts-demo-0.2.1.zip`, in one script.

### Removing it

**Not run yet,** for this kit or the Payers kit, whose removal this follows. **First delete the
seeded workspace,** `/default-domain/workspaces/contracts-demo`, and empty it from the trash: a
document whose type is gone cannot be read. Then a one-off script, as for the install:

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-remove contracts-demo --accept=true > /var/log/nuxeo/contracts-kit-remove.log 2>&1 || echo "contracts kit: removal failed, see /var/log/nuxeo/contracts-kit-remove.log"' 'rm -f "$0"' > /tmp/zz-contracts-kit-remove.sh && chmod 755 /tmp/zz-contracts-kit-remove.sh
```

```bash
docker cp /tmp/zz-contracts-kit-remove.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

## Seeding it

With the package installed and Nuxeo running, from the repository's root:

```bash
export NUXEO_USER=<administrator> NUXEO_PASS=<password>
```

```bash
node business-apps/packages/contracts-demo/demo/seed.mjs
```

- **What it writes:** seven contracts, under `/default-domain/workspaces/contracts-demo/contracts`,
  each named by its number. Their dates are counted from the UTC day it runs, so the renewals queue
  holds the same three whichever day that is: CTR-1007 (ended ten days ago, still active),
  CTR-1001 (ends in 30 days) and CTR-1002 (in 75). Four are active, one terminated, one expired,
  one a draft.
- **No user and no group.** The kit's groups and the people in them are the server's to decide. The
  contracts' managers, `avery.quinn` and `jordan.blake`, are user names only, so the page shows the
  name as stored.
- **Safe to run twice.** A contract already there is put back to `data.mjs`'s values, its dates
  counted again from today, and a property the data leaves empty emptied; a trashed one is restored
  and put back; a trashed document whose name only looks like a contract's is left in the trash,
  and two trashed copies of one stop the run; a place holding a document of another type stops the
  run, untouched.
- **It checks what it wrote:** last, the three page providers must return every seeded contract
  that belongs in them and none that does not, the renewals in the order of their end dates, the
  ended CTR-1007 among them. A contract the seed did not write may be there too. At the end it
  prints a link to one contract up for renewal and one overdue.
- **What it needs:** Node 24, nothing to install. `NUXEO_USER` and `NUXEO_PASS` have no default.
  `NUXEO_URL` defaults to `http://localhost:8080`. Exit 2 means a precondition is not met, before
  anything is written: no credentials, no server, or one that does not answer `/me` as Nuxeo does,
  credentials refused, the package not installed, or no `/default-domain/workspaces`.
- **Its controls,** `node business-apps/packages/contracts-demo/demo/seed.selftest.mjs`, run it
  against a stand-in for the REST API: they prove the script, not the server. CI does not run them.
  25 controls, each behaviour above among them, and a last one that no run, the refused ones
  included, prints a password or its Basic header. Since 0.2.1, a renewals page provider that leaves
  out the ended contracts fails the run, naming CTR-1007 alone; and one control reads the kit's
  labels rather than the script: the queue's and the home figure's names must say "overdue" while
  the data expects an ended contract there. Broken on purpose, each went red: the seed's check of a
  missing renewal turned off, and the two names put back to "Up for renewal". Each was seen failing: with the seed broken one
  way at a time (no check for a contract that does not belong, no write over an existing one, no
  emptied termination reason, no `/default-domain/workspaces` or `/me` precondition, the header or
  the refused password printed, any trashed name like a contract's restored, no order check), each
  of the nine turned at least one control red.

It prints the home, the queue and two record pages, on the app at `APP_URL`
(`http://localhost:4200` by default).

### Seeing it under `nx serve`, and "Switch app"

Under `npx nx serve nuxeo-ui` the app reads the kit's layouts, home, menu, queue and labels from
`apps/nuxeo-ui/public/agentic-ui-config/`, which `preview_package` writes, or, from the
repository's root:

```bash
C=business-apps/packages/contracts-demo/bundle/agentic-ui-config && npm run config:dev -- --layout Contract/view=$C/layouts/Contract/view.layout.json --layout Contract/edit=$C/layouts/Contract/edit.layout.json --home $C/home.json --navigation $C/navigation.json --labels en=$C/labels/en.json --queue $C/queues/up-for-renewal.json
```

Then start the dev server, or restart it. Signed in as an administrator, the home should show the
renewals figure, 3 for the seed's contracts, and its link to the queue, which should list
CTR-1007, CTR-1001 and CTR-1002 in that order. Not seen yet: nothing is installed.

**"Switch app" lists the two apps** (phase 0's demo, step 3) to a person in a group of each, on the
server, not under `config:dev`, which serves one app's files and wins over the registry. The seed
creates no one, so that person is the reviewer's to choose: for example, put one of the Payers
kit's people, such as `dana.lee`, in a group named `contract-managers`, created on the server. An
administrator in neither app's groups is listed no app, as `apps.json` answered on 24 November
2026: `"apps" : [ ]`.

## What a server shows, and what the dev server does

As the Payers kit's README says, for the same reasons:

| Part                         | Served by the package on a server    | Under `config:dev`                   |
| ---------------------------- | ------------------------------------ | ------------------------------------ |
| The model and page providers | Yes                                  | From the server                      |
| The two layouts              | Yes, to everyone                     | Yes                                  |
| `home.json`                  | From the registry, to the two groups | Yes, and it wins over the registry's |
| `navigation.json`            | From the registry, to the two groups | Yes, and it wins over the registry's |
| The queue                    | From the registry, to the two groups | Yes, and it wins over the registry's |
| `labels/en.json`             | From the registry, to the two groups | Yes, and it wins over the registry's |
| `app.json`                   | From the registry: it lists the app  | No                                   |

Seeing an app is not a security control: Nuxeo's permissions still decide which contracts anyone
reads, and the seed sets none, so its workspace has the server's defaults.

## Phase 3 feedback: where the skill and the generators fell short

What the build met, in the order it met it. None was changed in 0.1.0: the skill says a refusal
is fixed in the package, and the tools are another change's. That change, #703, closed items 1 to
4, 6 and the first point of 11, and item 12 in the tools; 0.2.0 closes item 12 in the kit. Each
closed item says so.

1. **No model, no kit.** Step 1 says to stop when the type does not exist, which is right for a
   customer's server. A demo kit needs a stand-in model, and nothing writes one: the schema, the
   type, the page providers and the manifest's second component were written by hand, as the
   Payers kit's were, and so was its content model, which the generators need before the server
   can answer it. **Closed:** `app-model` writes a stand-in type, its schema and page providers, in
   a model component the manifest lists first, and its `content-model.json`.
2. **The scaffold is not served by the registry.** `app-package` writes no `<app>` element, so
   "Switch app" cannot list a generated app until someone writes it by hand. The pipeline says so,
   as a note, and passes. **Closed:** `app-package` writes it, `app-registry` writes or refreshes
   it, and the generators that add a file keep it in step.
3. **The pipeline passed a layout the component does not contribute.** With
   `layouts/Contract/edit.layout.json` written and not yet named in the component, the pipeline
   passed, "2 layouts were held to the content model", and said nothing. The server would never
   serve that file. It refuses a contribution from the wrong place, not a file contributed from
   nowhere. **Closed:** step 2 refuses a `layouts/` file no enabled `<layout>` contributes.
4. **A field rule in plain words needs a form, and no generator writes one.** `required` and
   `readOnlyWhen` are forms only, and `app-layout` writes `view` mode alone, so the edit layout and
   its `<layout>` line were written by hand. **Closed:** `app-form` writes an Edit or Create form,
   with `--required`, and has the component contribute it.
5. **The form types its inputs:** an enumerated string is a text field, so the status is typed, not
   chosen, and the rule follows what is typed. A vocabulary would make it a picker; that is the
   model's to decide.
6. **The MCP tools' arguments are not in the skill.** `describe_document_type` takes `type` and
   `describe_schema` takes `schema`; the first calls, with `name`, were refused as invalid input.
   **Closed:** the skill names them.
7. **`preview_package` calls the Edit form "the Contract record page (edit)".** It is the Edit form.
8. **A record page cannot be previewed for a model no server has.** `preview_package` serves the
   layouts, and the page needs a record of the type. Hence the stubbed drawing above, which is not
   a preview.
9. **The generator's record page is a start:** one card of 13 fields in the model's order, no
   widget on an enumerated string. Expected, as the skill says, and most of the edit.
10. **The generator's `package.xml` describes what the package may not have:** "its record pages,
    queues, actions and labels", for a package with no `actions.json`. Left as written: the skill
    says not to edit it by hand.
11. **Two documents say otherwise than the code:**
    - package-pipeline.md, section 2, says a package that contributes no app is refused; the
      pipeline passes it with a note (item 2). **Closed:** the document now says what the code does;
    - layout-v2.md, section 3, gives `status-badge` "A select" in a form; the form draws a text
      field (item 5), as section 11 says.
12. **An app's address can take a platform route's.** `app.json`'s `address` defaults to its id,
    `contracts`, and the platform has a page at `/contracts` already, its component showcase
    (`app.routes.ts`). The shell does not open an app at its address yet (app-definition-v2.md,
    section 13), and the validator does not refuse one a platform route has; the kit names none,
    and the clash waits for that decision. **Closed:** the platform's routes are listed once,
    `PLATFORM_ROUTES`; the validator refuses a written address that is one, and `app-package`
    refuses an id that is one without `--address`. An id that is one, with no address, is still
    only noted. 0.2.0 gives the kit the address `contract-desk`, so the pipeline notes nothing.

## Not done yet

- **Installing, seeding, and the live record page,** above: the reviewer's.
- **The renewals queue has no facet,** and the home no breakdown: the page providers read the
  repository, which answers no aggregate.
- **The contract managers are names, not people.** The `user` widget shows a stored name the server
  cannot find as it is.
- **The Properties panel beside the record page** is version 1's generated one, listing the whole
  `contract` schema; a `metadata` layout would order it.
- **`content-model.json` is partly hand-written,** until it is exported from a server with the
  package installed.
