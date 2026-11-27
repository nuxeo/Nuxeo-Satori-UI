# Onboarding and disputes (demo)

Phase 7's kit for banks' onboarding and disputes
([development plan](../../../docs/business-apps/development-plan.md), phase 7, "Builds"), for its
demo step 4: "An onboarding case: KYC checklist, e-signature, the signed file filed". It was built
the way phase 3 says kits are built, as the [moves kit](../moves-demo/README.md) was: an agent took
the app builder skill's steps ([`.cursor/skills/app-builder/SKILL.md`](../../../.cursor/skills/app-builder/SKILL.md))
in order and wrote the app definition through the Builder MCP server's write tools, which commit a
change only when the pipeline passes it. What the tools could not write, the stand-in model's
facets, its checklist and three of its types, was written by hand, and the log says so at each
step. Every name in it is fictional. The log is [below](#how-it-was-built-the-log).

The e-signature step is the server's:
[`nuxeo-agentic-signature`](../../../nuxeo-agentic-signature/README.md), which the package depends
on. **No vendor is chosen** (decision H): the add-on's stand-in provider and stand-in service sign
nothing for real.

Since 0.2.0 a dispute keeps its **legal hold** on the server, for the plan's phase 7 demo step 5, "A
legal hold blocks a deletion, on the server": the platform's retention module, `nuxeo-retention`,
and [`nuxeo-agentic-records`](../../../nuxeo-agentic-records/README.md) 0.4.0, which the package now
depends on too ([below](#legal-holds-on-a-dispute)). And a case's page **creates a dispute raised
on it**, which closes the shortfall item 6 logged ([below](#a-dispute-raised-from-its-case)).

## The short version

- **An onboarding case's record page:** the case, its customer, product, status and risk rating as
  badges, and its days open; a **KYC checklist**, layout version 2's checklist card, **tickable**
  by anyone who may write the case: identity, address, sanctions, politically exposed person, source
  of funds, risk approved; an **E-signature** card, the add-on's `sgn:` properties: out, signed,
  declined or cancelled, the signers, when, and the latest request; the case's attachments, where
  its account agreement is; the **signature requests** sent for it, a related list; notes and
  history. Banners while it is out for signature, when a signer declined, and for a high-risk case
  not yet decided.
- **The e-signature step:** a signature request, `ESignatureRequest`, created from the onboarding
  register's Create menu: the case, the attachment's file name, the signers and a message. Saved,
  the add-on sends the agreement; the provider's callback ends it, and, signed, the signed agreement
  takes the original's place on the case, which is checked in as a new version with the provider's
  evidence. The request's own page shows where it is, its signers, and once signed the version and
  the SHA-256 of the file sent, the file signed and the evidence. Its Edit form cancels it.
- **A dispute's record page** of its own: the customer, account, amount, reason and status, the
  dates and days open, the resolution, attachments and history, with banners when it is overdue or
  due within five days; an Edit form that asks for the resolution once it is resolved. Since 0.2.0,
  the onboarding case it is raised on, and a **legal hold** card: its retention, its hold, the holds
  placed and released with who, when and why, and Place or Release legal hold, for a dispute
  analyst, through the deployment's allow-list. While it holds, the server refuses to delete the
  dispute, to put it in the trash or to change its files, whoever asks, and the page says why.
- **A case's disputes,** a related list on its page, with **New dispute**: the dispute's create
  form, the case filled in and read-only, filed in the disputes register, under the person's own
  permission to create there.
- **Queues:** open onboarding cases, with status and risk facets; agreements awaiting signature;
  open disputes, with reason and status facets.
- **A home and a menu** for three groups, `onboarding-officers`, `kyc-analysts` and
  `dispute-analysts`: open cases by status, cases in KYC review, open high-risk cases, agreements out
  for signature, and open disputes by reason.
- **A stand-in model** (below) and **a seed** that creates no user and no group.

## What is in it

| File                                                                                                            | What it is                                                                                                                               | Written by                                          |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `bundle/agentic-ui-config/app.json`                                                                             | The app, `onboarding`, for its three groups                                                                                              | `app-package`                                       |
| `bundle/agentic-ui-config/layouts/OnboardingCase/view.layout.json`                                              | The case's record page                                                                                                                   | `app-layout`, then `write_package_file`             |
| `bundle/agentic-ui-config/layouts/OnboardingCase/edit.layout.json`                                              | Its Edit form: the notes required once it is declined                                                                                    | `app-form`, then `write_package_file`               |
| `bundle/agentic-ui-config/layouts/DisputeCase/view.layout.json`, `edit.layout.json`                             | A dispute's record page, with its legal hold card, and Edit form                                                                         | `app-layout`, `app-form`, then `write_package_file` |
| `bundle/agentic-ui-config/layouts/DisputeCase/create.layout.json`                                               | A dispute's Create form, its case read-only                                                                                              | **By hand** (0.2.0)                                 |
| `bundle/agentic-ui-config/actions.json`                                                                         | Place and Release legal hold, the holds card's two actions, `"on": ["card"]`                                                             | **By hand** (0.2.0)                                 |
| `deployment/onboarding-demo-operations-config.xml`, `deployment/build-allow-list.json`                          | The demo server's allow-list for the two actions, and the pipeline's. Not packaged                                                       | **By hand** (0.2.0)                                 |
| `bundle/agentic-ui-config/layouts/ESignatureRequest/create.layout.json`                                         | Send for signature: the case, the attachment, the signers, a message                                                                     | `app-form`, then `write_package_file`               |
| `bundle/agentic-ui-config/layouts/ESignatureRequest/view.layout.json`, `edit.layout.json`                       | A request's page, and the form that cancels it                                                                                           | `app-layout`, `app-form`, then `write_package_file` |
| `bundle/agentic-ui-config/queues/*.json`                                                                        | The three queues                                                                                                                         | `app-queue`, then `write_package_file`              |
| `bundle/agentic-ui-config/home.json`, `navigation.json`                                                         | The home and the menu                                                                                                                    | `write_package_file`, with `app-registry`           |
| `bundle/agentic-ui-config/labels/en.json`                                                                       | Every label the files name                                                                                                               | The generators, then `write_package_file`           |
| `bundle/OSGI-INF/onboarding-demo-model.xml`, `bundle/schemas/onboarding.xsd`, `dispute.xsd`, the search schemas | The stand-in model's two types and its four page providers                                                                               | `app-model`                                         |
| `bundle/OSGI-INF/onboarding-demo-signature.xml`, `bundle/schemas/onboarding_kyc.xsd`                            | The checklist, the add-on's facet on the case, the request type, the two registers                                                       | **By hand** (the log, step 2)                       |
| `bundle/OSGI-INF/onboarding-demo-config.xml`                                                                    | The configuration component: the layouts, and the app for the registry                                                                   | The generators                                      |
| `bundle/META-INF/MANIFEST.MF`, `package/package.xml`                                                            | The bundle and the Marketplace package, which depends on `nuxeo-agentic-signature:0.1.0` and, since 0.2.0, `nuxeo-agentic-records:0.4.0` | `app-package`, then **by hand**                     |
| `content-model.json`                                                                                            | The model as a server with the add-on and the kit would answer it, for the pipeline                                                      | `app-model`, then **by hand**                       |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/seed.selftest.mjs`                                                      | The seed, its fictional records and its 21 controls. Not packaged                                                                        | By hand: the write tools write no code              |

## The stand-in model

Fictional, and replaced whole when a real one arrives.

| Type                 | Schemas, and facets                                                                                                                        | Opens as                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `OnboardingCase`     | `common`, `dublincore`, `files`, `onboarding` (`onb`), `uid`, `onboarding_kyc` (`kyc`); `Versionable`, and the add-on's `Signable` (`sgn`) | A record page                                     |
| `DisputeCase`        | `common`, `dublincore`, `files`, `dispute` (`dsp`), whose `dsp:case` names the onboarding case it is raised on, by its id, since 0.2.0     | A record page                                     |
| `ESignatureRequest`  | `common`, `dublincore`; the add-on's `SignatureRequest` (`sigreq`)                                                                         | A record page: its files are `sigreq:` properties |
| `OnboardingRegister` | A folder whose Create menu offers `OnboardingCase` and `ESignatureRequest`                                                                 | Browse                                            |
| `DisputeRegister`    | A folder whose Create menu offers `DisputeCase`                                                                                            | Browse                                            |

| Page provider                   | Lists                                                         | From                                                |
| ------------------------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| `onboarding_open_cases`         | Cases open, in KYC review or awaiting signature, oldest first | The search index, with status and risk aggregates   |
| `onboarding_open_disputes`      | Disputes open or under investigation, the soonest due first   | The search index, with reason and status aggregates |
| `onboarding_case_signatures`    | A case's signature requests, newest first, by its id          | The repository                                      |
| `onboarding_awaiting_signature` | Requests out for signature, the oldest first                  | The repository                                      |
| `onboarding_case_disputes`      | A case's disputes, newest first, by its id (0.2.0)            | The repository                                      |
| `onboarding_dispute_registers`  | The disputes registers, the oldest first: where New files one | The repository                                      |

The case's statuses (Open, KYC review, Awaiting signature, Approved, Declined) are the officers'
to set; the e-signature card's are the add-on's, and nothing in the kit writes them. A case
"Awaiting signature" is an officer's word for it, and `sgn:status` `sent` the server's.

## The demo

Demo step 4, once both packages are installed, the stand-in configured
([the add-on's README](../../../nuxeo-agentic-signature/README.md#installing-it-on-the-local-docker-nuxeo-for-the-demo))
and the kit seeded (below). Not run: no server has either package.

1. **A KYC analyst** opens `ONB-1001` from Open onboarding cases: two of six items ticked. Ticking
   "Sanctions screening clear" writes the checklist, with who and when.
2. **An onboarding officer** opens `ONB-1003`, every item ticked, its account agreement,
   `account-agreement-onb-1003.pdf`, among its attachments.
3. In Browse, the onboarding register, **Create, Signature request:** what is signed, the case
   (picked), `account-agreement-onb-1003.pdf`, the two directors as signers, a message. Saved, the
   agreement is sent: the request's page says "Sent to the e-signature service", and the case
   "out for signature". It is in Awaiting signature, and on the officers' home.
4. **The signers sign,** played by the stand-in service:
   `STANDIN_API_KEY=… node nuxeo-agentic-signature/demo/esign-stand-in.mjs sign <envelope>`, the
   envelope from the request's page.
5. **The signed file filed:** the case shows the signed agreement,
   `account-agreement-onb-1003-signed.pdf`, in the original's place, its E-signature card "signed",
   and its history a new version, 1.0, which holds the evidence; the request links that version and
   shows the three SHA-256s. The request leaves Awaiting signature.
6. **The other ways it ends:** `decline <envelope> <reason>` on `ONB-1001`'s request shows the
   banner and the reason; the officer sets a request's status to cancelled in its Edit form, and it
   ends. `resend <envelope>` posts a callback again, and nothing changes; `forge <envelope>` posts
   one signed with another secret, and Nuxeo refuses it, 401.

A dispute analyst's part: Open disputes, by reason; `DSP-2002` overdue; its Edit form asks for
the resolution once it is resolved. Then demo step 5, [below](#legal-holds-on-a-dispute), and a
dispute raised from its case, [below](#a-dispute-raised-from-its-case).

## Legal holds on a dispute

Phase 7's demo step 5, "A legal hold blocks a deletion, on the server", on `DSP-2002`. Not run: no
server has the kit, the records add-on or the retention module.

1. **A dispute analyst** with the platform's `ManageLegalHold` on the disputes register, which the
   seed grants `dispute-analysts`, opens `DSP-2002`. Its Legal hold card: not under retention, no
   legal hold, none placed yet, and **Place legal hold**.
2. **Place legal hold**, with a reason, "Chargeback dispute with the card scheme". The button runs
   the retention module's own `Document.Hold`, through `AgenticUi.RunAction` and the deployment's
   allow-list: the dispute is made a record, and held. The card says "On legal hold", and the hold
   placed, by whom, when, and the reason, the platform's audit's comment.
3. **Deleting it is refused, on the server.** For the analyst, the platform takes `Remove` from a
   held record: the page offers no Delete, and a deletion or a trash sent anyway is refused, 403,
   with the platform's message. An administrator's, which the platform would let through,
   `nuxeo-agentic-records` refuses, 409: "This record is under a legal hold: it cannot be put in the
   trash or deleted until the hold is released." Removing or replacing an attachment, in the
   document page's Attachments, is refused for everyone, 409, and the page shows the add-on's
   reason: "This record is under a legal hold: its files cannot be changed until the hold is
   released." So is putting the disputes register in the trash. Editing the dispute's status or
   resolution is not: a hold keeps the record and its files, not its description, as the
   platform's does.
4. **Release legal hold**, with a reason, "Settled with the merchant". It runs
   `Records.ReleaseLegalHold`, the records add-on's, since the module's `Document.Unhold` takes no
   reason. The card lists the release under the hold, with its reason, and offers Place again.

**The allow-list is the deployment's,** `deployment/onboarding-demo-operations-config.xml`, which
the server's administrators put in `nxserver/config/`; the package never contributes one, and the
pipeline holds the kit's `actions.json` to `deployment/build-allow-list.json`. It allows each
operation for the onboarding app's buttons, to dispute analysts, on a dispute case, with a reason
of at most 500 characters, and the permission `ManageLegalHold`, which the platform checks again
itself. Without it the registry serves neither button, and the card shows the dispute's hold and
offers nothing.

## A dispute raised from its case

Closes the shortfall's item 6, "a record page cannot create a related record". Not run.

1. **A dispute analyst**, who may read the onboarding register (the seed grants `dispute-analysts`
   `Read` there), opens `ONB-1001`. Its Disputes card lists `DSP-2002`, raised on it, and offers
   **New dispute**.
2. **New dispute** opens the dispute's Create form: "For ONB-1001 …, filed in Disputes", the
   onboarding case shown read-only by its title, the rest to fill in. Saved, the dispute is created
   in the disputes register, which `onboarding_dispute_registers` finds, as the analyst, with
   `dsp:case` the case's id; the card lists it, and the case page stays open.
3. **An onboarding officer** on the same page sees no New dispute: the disputes register gives
   officers nothing, so its permissions do not let them add to it. A create they sent anyway, past
   the page, is the server's to refuse, and its reason is what the form would show.

The reference is the layout's, layout version 2's `create` on a related list
([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 7): `"type": "DisputeCase"`,
`"field": "dsp:case"`, `"in": { "pageProvider": "onboarding_dispute_registers" }`.

## Building it

```bash
npm run app-package -- business-apps/packages/onboarding-demo --platform 0.2.0 \
  --model business-apps/packages/onboarding-demo/content-model.json \
  --allow-list business-apps/packages/onboarding-demo/deployment/build-allow-list.json
```

It writes `dist/onboarding-demo-0.2.0.zip`, held to the package's own `content-model.json`, since it
ships a stand-in model, and its `actions.json` to the deployment's allow-list: 8 layouts held to the
model, 16 files passed, on 27 November 2026. With `--previous` and the staging branch's 0.1.0:
"21 changes, which need a patch version. 0.2.0 raises the minor". Seen failing on a copy: a holds
card naming `onboarding.dispute.placeHld` and a New on `dsp:cas`, each refused at step 2, by name.

## Installing it on a local Nuxeo

**Not run.** Installing is the orchestrator's, after review. As the moves kit's install, with the
add-on's package first: build both, copy both zips into the container, and a one-off script in
`/docker-entrypoint-initnuxeo.d/` that installs `nuxeo-agentic-signature-0.1.0.zip`, the retention
module, `nuxeo-retention`, from the Marketplace, `nuxeo-agentic-records-0.4.0.zip`, then
`onboarding-demo-0.2.0.zip`, with `nuxeoctl mp-install --accept=true`, and removes itself; put
`deployment/onboarding-demo-operations-config.xml` in `nxserver/config/`; restart.
Check: the server log's `Component Loading Status` has nothing pending or missing;
`/nuxeo/agentic-ui-config/layouts.json` lists the three types' layouts; and the MCP server's
`describe_document_type` `OnboardingCase` lists `kyc:checklist` and `sgn:status`, where step 1 was
refused.

**To remove it:** delete the seeded workspace, `/default-domain/workspaces/onboarding-demo`, and
empty it from the trash, since a document whose type is gone cannot be read, and a request is
deleted by an administrator only, once it is no longer out; then `nuxeoctl mp-remove onboarding-demo --accept=true`
the same way.

## Seeding it

With both packages installed and Nuxeo running, from the repository's root:

```bash
export NUXEO_USER=<administrator> NUXEO_PASS=<password>
node business-apps/packages/onboarding-demo/demo/seed.mjs
```

- **What it writes:** under `/default-domain/workspaces/onboarding-demo`, the onboarding register,
  `onboarding`, with four cases, and the disputes register, `disputes`, with three, each named by
  its number. Dates are counted from the UTC day it runs:
  - **`ONB-1001`**, a business, in KYC review, medium risk, two items ticked;
  - **`ONB-1002`**, an individual, open, low risk, nothing ticked;
  - **`ONB-1003`**, a business, awaiting signature, every item ticked: the one to send;
  - **`ONB-1004`**, an individual, in KYC review, **high risk**, so its banner shows;
  - **`DSP-2001`** open, **`DSP-2002`** under investigation and two days overdue, **`DSP-2003`**
    resolved for the customer, so not in Open disputes.
- **Each case's account agreement,** a one-page PDF the seed makes, saying it is fictional,
  `account-agreement-<number>.pdf`, attached to a case with no attachment. A case's attachments are
  never written over: one with others and not this one is left as it is, and said so.
- **The groups' permissions:** `ReadWrite` on the onboarding register for `onboarding-officers` and
  `kyc-analysts`, since an officer sends a case's agreement and an analyst ticks its checklist, both
  writes of the case; `ReadWrite` on the disputes register for `dispute-analysts`, and, since 0.2.0,
  the retention module's `ManageLegalHold` there, to place and release a dispute's hold, and `Read`
  on the onboarding register, to read the case a dispute is raised on and raise one from it.
- **A dispute raised on a case:** `DSP-2002`'s `dsp:case` is `ONB-1001`'s id, the same customer's.
- **No user and no group:** the groups and the people in them are the server's to decide. The
  officers, analysts and ticks are user names only.
- **Nothing sent for signature:** no request, and no `sigreq:` or `sgn:` property, which are the
  add-on's. Sending is the demo's.
- **Safe to run twice:** a record already there is put back to `data.mjs`'s values, but for its
  checklist, which people tick, and its attachments; a trashed one is restored; a place holding a
  document of another type stops the run, untouched.
- **It checks what it wrote:** the open cases and open disputes page providers must list every
  seeded record that belongs in them and none that does not, asked again until the search index
  agrees, up to `NUXEO_INDEX_WAIT_MS` (15 seconds by default).
- **What it needs:** Node 24. `NUXEO_USER` and `NUXEO_PASS` have no default and must be an
  administrator's. Exit 2 is a precondition, before anything is written: no credentials, no server,
  a `/me` that is not a user, not an administrator, or the e-signature add-on, the retention
  module, the records add-on or a kit type missing.
- **Its controls,** `node business-apps/packages/onboarding-demo/demo/seed.selftest.mjs`, 21 of 21
  since 0.2.0, 18 before,
  against a stand-in for the REST API: they prove the script, not a server. Ten ways of breaking
  the seed, one at a time, each turned at least one red: no administrator check, no check that
  `/me` is a user, no add-on precondition, no dispute type precondition, the checklist written on
  every run, a case's attachments written over, the Basic header printed, no check of the queues, a
  signature request sent by the seed, and another type's place written over.

## How it was built: the log

Run on 26 November 2026, from about 20:30 to 21:30 IST, in a worktree of
`staging/enterprise-grade-app` at `cc9afbb66`, on Node 24.22.1, by the agent that built the
e-signature add-on in the same branch. The agent spoke to the Builder MCP server over stdio through
a small client of its own outside the repository, as the moves kit's run did: registering the
server with `claude mcp add-json` would change the person's own Claude configuration. **Nothing was
written to any server.** The times are the agent's, from its commands.

### Step 0. Before you start (before 20:58)

| What                               | Result                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`, Node 24.22.1             | Passed; `package-lock.json`'s SHA-256 the same before and after                                                                                                  |
| A server whose model may be shared | The local Docker Nuxeo, which holds fictional records only, read with its documented default administrator account from the environment, for step 1's reads only |
| The platform version               | `0.2.0`, from `libs/platform/package.json`                                                                                                                       |

### Step 1. Read the server (20:58, 1 minute)

| Asked                                          | Answer                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `get_content_model`                            | 76 types, 69 facets, 118 schemas: no onboarding or dispute type                        |
| `describe_document_type` `OnboardingCase`      | Refused: "The server has no document type", with "Close names: Case", the Payers kit's |
| `describe_document_type` `DisputeCase`         | Refused, the same                                                                      |
| `describe_schema` `files`                      | `files:files`, `complex[]` of `{ file: blob }`, used by nine types                     |
| `describe_schema` `signature_request`          | Refused: the add-on is installed nowhere                                               |
| `list_page_providers`, `onboarding`, `dispute` | 119 page providers, none of either                                                     |
| `list_vocabularies`, `list_workflows`          | The stock ones and the Payers kit's: none for onboarding or disputes                   |
| `list_operations` `Signature`                  | None: no e-signature operation on the server, and the add-on adds none                 |

**The skill says to stop here:** the types do not exist, and creating them is Studio's. The request
asked for a stand-in model, so the kit carries one, written by `app-model` where it can be.

### Step 2. Write the files, through the write tools (21:03 to 21:09)

| Call                                                                                                                                                                                                                                                                                                    | Answer                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apply_package_changes`, 9 changes: `app-package` (no `type`; owner `nuxeo`, app `onboarding`, three groups); `app-model` for `OnboardingCase` and `DisputeCase`, each with `attachments`; their two page providers with `aggregates`; `app-layout` for both; `app-form` Edit for both, with `required` | `written: true`, 19 files, in 6.7 seconds                                                                                                         |
| **By hand, outside the write tools** (below): `onboarding-demo-signature.xml`, `onboarding_kyc.xsd`, the manifest, `package.xml`'s dependency and vendor, `content-model.json`                                                                                                                          | `npm run app-package` passed after it: 4 layouts held to the model, 6 files                                                                       |
| `apply_package_changes`, 8 changes: `app-model` for the requests' two page providers; `app-layout` for `ESignatureRequest`; `app-form` Create and Edit for it; `app-queue` three times                                                                                                                  | `written: true`, 9 files, in 6.3 seconds, with **three warnings**: no Properties heading for `onboarding_kyc`, `signable` and `signature_request` |
| `apply_package_changes`, 14 changes: `labels/en.json` first, the seven layouts, the three queues, the home and the menu, whole, then `app-registry`                                                                                                                                                     | **Refused**, not on purpose: `written: false`, step 2, `banners[1].tone: tone is one of info, warning, negative` (item 7 below). Nothing written  |
| The same, the request's signed banner `info`                                                                                                                                                                                                                                                            | `written: true`, 14 files, in 2.7 seconds, no warning. `app-registry`: "Now names: home.json, navigation.json"                                    |
| `write_package_file`, on purpose: the checklist card on `kyc:checkList`                                                                                                                                                                                                                                 | Refused: `cards[1].checklist.field: "kyc:checkList" is not a property of the type "OnboardingCase" or of its facets`                              |
| `write_package_file`, on purpose: Open disputes with a facet on `dsp_analyst_agg`                                                                                                                                                                                                                       | Refused: the page provider "has no aggregate "dsp_analyst_agg": it defines dsp_reason_agg, dsp_status_agg"                                        |
| `write_package_file`, on purpose: the signers shown with a widget `signature-pad`                                                                                                                                                                                                                       | Refused: `the widget "signature-pad" is not registered`. Both files' SHA-256 unchanged after the three                                            |

The three refusals on purpose are negative controls of the write tools, as the moves kit's run had:
they show a misspelt property, a missing aggregate and an unregistered widget refused at write
time, and the package left as it was.

**What was written by hand, and why.** The skill says never to write a model component by hand:
`app-model` writes a type extending `Document` with `common`, `dublincore`, optionally `files`, and
one schema of flat properties, and nothing else. So, kit-blocking, each in a component of its own,
`onboarding-demo-signature.xml`, which `app-model` never writes, so that it may write its own again:

- **the KYC checklist,** a list of complex values, `kyc:checklist`, in a schema of its own,
  `onboarding_kyc`: `app-model` writes no complex property (item 1);
- **the add-on's facet on the case,** `Signable`, with `Versionable` and `uid`, added to the stand-in
  type with `<doctype append="true">`, which the pipeline reads as an addition: `app-model` gives a
  type no facet (item 2);
- **the request type and the two registers:** `ESignatureRequest`, a type with no schema of the
  kit's, only the add-on's facet, and two folders with subtypes: `app-model` writes neither (item 3);
- **`content-model.json`'s entries for them,** so that the pipeline and the write tools hold the
  layouts to the add-on's properties. Written after every `app-model --properties`, which writes a
  type's entry again from scratch (item 4);
- **the manifest,** to list the component, and **`package.xml`,** for the dependency on
  `nuxeo-agentic-signature:0.1.0`, and the vendor, `Nuxeo` (item 5).

Then the edits, each written whole with `write_package_file` from layout-v2.md and
app-definition-v2.md: the case's page in seven cards with its three banners, the checklist card
`tickable`, the e-signature card, and the requests as a related list given the case's `ecm:uuid`;
the forms' required fields and rules (`app.rules.fieldIn` for the notes and the resolution,
`core.notBefore` for a dispute due before it was opened); a request's Create form with its signers
as a `table`, and its Edit form with only its status, read-only once it has ended; widgets a person
would pick (`status-badge` with tones, `currency` in USD, `user`, `chips`, `relative-date`,
`document-link`, with `show` for the case's customer on the request's page); the queues' facets,
the home and the menu.

### Step 3. Check them: every write already did (21:10)

| Check                                                                                                                                                                                                     | Result                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run app-package -- business-apps/packages/onboarding-demo --platform 0.2.0 --model business-apps/packages/onboarding-demo/content-model.json`                                                        | Passed: 7 layouts held to the model, 14 files passed                                                                                          |
| `validate_package`                                                                                                                                                                                        | `passed: true`, `asCi: true`, no finding                                                                                                      |
| By hand, what the pipeline does not check: every property a layout, a queue, a related list, a sort, a rule, a computation or a `show` names, against the type of the file, its page provider or its link | 116 references, none missing. Seen failing, on a copy, with `sigreq:sentFilename` in the related list and `dsp:numero` in a queue: both named |
| The pipeline on that broken copy                                                                                                                                                                          | **Refused it**, both columns named: since the moves kit's feedback it holds queue and related-list columns to the type                        |

### Step 4. Preview in dev mode, as far as it goes (21:12)

| What                                                                     | Result                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview_package`, `DEV_SERVER_URL=http://localhost:4299`, no dev server | `served: true`: the home, the menu, three queues, the labels, seven layouts; `app.json` not served, as the registry's. Not answering                                      |
| The pages in a browser                                                   | **Not seen.** No dev server was started, and no server holds an `OnboardingCase`, a `DisputeCase` or an `ESignatureRequest`: the add-on and the kit are installed nowhere |

What a browser would show is what the moves kit's run found for a kit no server has: the home's
figures "Unavailable", each queue's "Something went wrong", since the server has none of the four
page providers.

### Step 5. Publish to pre-production

**Not done, and not built in the MCP server.** No `app-package/*` tag was pushed.

### The seed (21:15)

Written by hand: the write tools refuse `demo/*.mjs`, as code. On the records and moves kits'
model. Its controls, 18 of 18, and the ten ways of breaking it, are [above](#seeding-it). One
control was too weak at first: a `/me` that was not a user was refused by the administrator check
anyway, so removing the user check left it green; it now answers an administrator with no id. The
independent review found the dispute type missing from the preflight, which would have stopped the
run after its first writes rather than before them; it is checked now, with a control of its own.

## 0.2.0: what was written, and seen failing (27 November 2026)

Written by hand, in a worktree of `staging/enterprise-grade-app`, beside the platform's two pieces
it needed: layout version 2's holds card and a related list's `create`, and the `card` placement of
an action. **Nothing was written to any server**; the local Nuxeo was read once, to see that it
answers a document's `isRecord`, `retainUntil` and `hasLegalHold`, and that it has no legal hold
operation without the retention module.

| What                                                                                                   | Result                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run app-package` with `--model`, `--allow-list` and `--previous` (0.1.0, from staging)            | 8 layouts held to the model, 16 files passed; 0.2.0 raises the minor                                                                         |
| The same, on a copy whose holds card names `onboarding.dispute.placeHld` and whose New names `dsp:cas` | Refused at step 2, both named                                                                                                                |
| The seed's controls                                                                                    | 21 of 21; with the retention module's precondition taken out, its control red                                                                |
| The holds card, the New button and dialog, the form's fixed value, the server's reason                 | Their specs, with axe at WCAG 2.2 AA; each check taken out in turn turned its spec red (the pull request lists them)                         |
| The deployment allow-list                                                                              | `AllowListXmlTest`: it registers, and the registry serves both actions to a dispute analyst                                                  |
| A held record's deletion, trash, folder and files                                                      | `LegalHoldGuardTest` and `ReleaseLegalHoldTest`, in Nuxeo's test framework ([the add-on's README](../../../nuxeo-agentic-records/README.md)) |

## Where the tools fell short: phase 7 feedback

| #   | What                                                                                                                                                                                                | Kit-blocking | Done here                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `app-model` writes no complex property, so no checklist, which layout version 2's checklist card needs in a fixed shape: `item`, `done`, `doneBy`, `doneOn`                                         | Yes          | By hand, a schema of its own. Proposal: a property type `checklist` for `app-model`, which writes that shape                                                                                                                                           |
| 2   | `app-model` gives a type no facet: an add-on's (`Signable`), or the platform's (`Versionable`, with `uid`)                                                                                          | Yes          | By hand, `<doctype append="true">`. Proposal: `--facets`                                                                                                                                                                                               |
| 3   | `app-model` writes no type without a schema of the kit's, and no folder with subtypes, so a kit cannot have a register whose Create menu offers its types                                           | Yes          | By hand. Proposal: `--schemaless` with `--facets`, and `--folder` with `--subtypes`                                                                                                                                                                    |
| 4   | `app-model --properties` writes a type's `content-model.json` entry again from scratch, dropping facets and schemas added to it                                                                     | No           | The hand edits came after every such call                                                                                                                                                                                                              |
| 5   | The write tools do not write `package.xml` or the manifest, so a kit that depends on an add-on, or lists a component of its own, edits both by hand                                                 | No           | By hand. Proposal: `app-package --depends`                                                                                                                                                                                                             |
| 6   | ~~**A record page cannot create a related record:** a signature request is created from the register's Create menu, in Browse, with the case picked, not from the case's page~~ **Closed in 0.2.0** | No           | Layout version 2's `create` on a related list: the case's Disputes card offers New dispute ([above](#a-dispute-raised-from-its-case)). The signature requests' list could offer it the same way; it does not yet, since a request is sent once created |
| 7   | A banner's tone is `info`, `warning` or `negative`: no `positive`, which a "signed" banner would take                                                                                               | No           | The signed banner is `info`                                                                                                                                                                                                                            |
| 8   | A single file property has no widget that downloads it on a record page (`image` shows a picture; `file-list` takes a list): the request's signed file and evidence, and the case's `sgn:evidence`  | No           | Their SHA-256 shown, and the signed file is on the case's attachments                                                                                                                                                                                  |
| 9   | No picker for one of a record's attachments: the file to sign is typed by its name                                                                                                                  | No           | A text field, which the add-on checks against the case's attachments                                                                                                                                                                                   |
| 10  | A `document-link` to a version shows its title, not its label                                                                                                                                       | No           | The request links the signed version; its label is in the case's history                                                                                                                                                                               |

The proposals are for the generators' owner: no generator, validator or pipeline was changed to
make this kit pass.

## Not done yet

- **On a server:** nothing. The demo has not run; the add-ons and the kit are installed nowhere.
  The steps file for 0.2.0's two demos, `scripts/beta-harness/steps/onboarding-holds.mjs`, is
  written and has not run.
- **A hold on a case,** rather than a dispute: the case's page has no holds card yet. The card and
  the actions are the platform's; a second allow-list entry's type would add it.
- **A real e-signature provider,** decision H, and so the step's demo on a vendor's service.
- **The onboarding and disputes workflows:** a case's approval, and a dispute's investigation, are
  statuses a person sets, not route models. A workflow's node could create a signature request the
  way the Create form does.
- **The property and casualty claims kit,** the other of phase 7's kits, is not this one.
- **French, Spanish and the Nordic languages:** English labels only.
