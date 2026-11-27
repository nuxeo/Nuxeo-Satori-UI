# Property and casualty claims (demo)

One of phase 7's kits for insurers: property claims and the policies they are made on
([development plan](../../../docs/business-apps/development-plan.md), phase 7, "Builds"), for its
demo step 1, "a property claim with live policy and payment data from the core system, beside its
photos and documents". It was built the way phase 3 says kits are built, as the
[contracts](../contracts-demo/README.md) and [moves](../moves-demo/README.md) kits were: an agent
took the app builder skill's steps
([`.cursor/skills/app-builder/SKILL.md`](../../../.cursor/skills/app-builder/SKILL.md)) in order,
with the generators, the package pipeline and the Builder MCP server, and wrote **every package
file through the server's write tools**, which commit a change only when the pipeline passes it.
Every name in it is fictional. The log of each step, its result, its time and each departure is
[below](#how-it-was-built-the-log).

**Version 0.2.0 adds capture,** for phase 7's demo step 3, "A scanned claim letter classified, its
fields extracted, and filed on the claim": a claims mail inbox, on the
[`nuxeo-agentic-capture`](../../../nuxeo-agentic-capture/README.md) add-on, which the package now
depends on, and a queue of the mail that waits for a person ([below](#capture-the-mail-inbox)).
Those files were written by hand, not through the write tools, and checked by the pipeline
([the log for 0.2.0](#020-capture-by-hand-27-november-2026)).

## The short version

- **A Property Claim record page:** the loss (its date, cause, location and description), the
  policy, as a `document-link` to the Policy record with the policy's number, holder and insured
  property read from it (`show`), the adjuster, the reserve and the status. Then:
  - **"Policy and payment, from the core system":** an `external` card of live data, the policy's
    status and number, the deductible, and the claim's payment status, amount, day and reference,
    read through the connector `pcclaims.policyPayments` from the connectors' stand-in core
    system. **The kit only configures it:** the card, and the connector's contribution in
    `demo/`. Nothing is installed, and the stand-in core system has no record for this kit's
    claims yet ([below](#the-core-systems-card));
  - **photos and documents** as the claim's attachments, `files:files`, listed on the page, each
    with a preview in the document page's Attachments panel beside it
    ([below](#photos-and-documents));
  - **a banner when the claim was reported more than 30 days after the loss,** with
    `app.rules.dateAfter`, and the days from the loss to the report as a computed field
    (`core.dateDiff`). A banner for a denied claim too.
- **A Policy record page:** the policy, its holder, its coverage, and its claims as a related list,
  latest loss first. Banners for a policy not in force and one ending within 30 days.
- **The claim's Edit form,** with the rule asked for in plain words, "a denial reason is required
  when the status is Denied", as `app.rules.fieldIn`, and a check that the loss date is not after
  the report date, as `core.notBefore` on the report date. The claim number, the connector's key,
  is read-only there.
- **Three queues:** open claims, oldest report first, with facets on status, cause of loss,
  adjuster and policy, the last showing each policy by its title (#751); and, for claims managers,
  open claims reserved over $50,000, largest reserve first. Both show each claim's policyholder,
  read from its policy. Since 0.2.0, the third: the mail to confirm
  ([below](#capture-the-mail-inbox)).
- **A home, a menu and labels.** Open claims by status and by cause for everyone; the reserves over
  $50,000 for claims managers; the claims reported and not yet investigated for adjusters.
- **An `app.json` that names its own groups,** `property-claims-adjusters` and
  `property-claims-managers`, and a component that contributes the app to the app registry. Its id
  is `pc-claims` and its address `property-claims`, neither a platform route (`PLATFORM_ROUTES` in
  `libs/shared/app-definition`).
- **A stand-in model, in its own component:** `PropertyPolicy` and `PropertyClaim`, their schemas,
  a search document and three page providers, written by `app-model`. Fictional, and replaced whole
  when a real one comes.
- **A seed script,** with its controls, writing five fictional policies and eight claims. It
  creates no user and no group.
- **Since 0.2.0, a claims mail inbox:** a letter put into it is classified, its fields extracted,
  matched to its claim by the claim number and filed on it, by the capture add-on; one it cannot
  file by itself waits in **Mail to confirm**, where an adjuster confirms, corrects or rejects it.
  The claim page lists the mail filed on it. Two fictional letters, as PDFs, and a script that
  mails them in, as a scanner would ([below](#capture-the-mail-inbox)).
- **Not installed anywhere.** The package passes the pipeline; installing it, seeding it and
  connecting the core system are a person's ([below](#installing-it-on-a-local-nuxeo)).

## What is in it

| File                                                               | What it is                                                                                                  | Written by                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `bundle/agentic-ui-config/app.json`                                | The app: id `pc-claims`, address `property-claims`, version 0.2.0, two groups                               | `app-package`                                                |
| `bundle/agentic-ui-config/layouts/PropertyClaim/view.layout.json`  | The claim page: two banners; the claim, the loss, the policy, the core system, attachments, denial, history | `app-layout`, then `write_package_file`                      |
| `bundle/agentic-ui-config/layouts/PropertyClaim/edit.layout.json`  | The claim's Edit form: the denial reason's rule, the loss date's check, the number read-only                | `app-form`, then `write_package_file`                        |
| `bundle/agentic-ui-config/layouts/PropertyPolicy/view.layout.json` | The policy page: two banners, three cards, its claims and its history                                       | `app-layout`, then `write_package_file`                      |
| `bundle/agentic-ui-config/queues/open-property-claims.json`        | Open claims, oldest report first, with Status, Cause of loss, Adjuster and Policy facets                    | `app-queue`, then `write_package_file`                       |
| `bundle/agentic-ui-config/queues/high-reserve.json`                | Open claims reserved over $50,000, largest first, for claims managers                                       | `app-queue`, then `write_package_file`                       |
| `bundle/agentic-ui-config/home.json`, `navigation.json`            | The home's four figures, and the menu: the home and the two queues; since 0.2.0, five and three             | `write_package_file`                                         |
| `bundle/agentic-ui-config/labels/en.json`                          | Every label key the files name, in English, and each schema's Properties heading                            | The generators, then `write_package_file`                    |
| `bundle/OSGI-INF/pc-claims-demo-config.xml`                        | The component: the three layouts, and the app with the five files the registry serves                       | The generators                                               |
| `bundle/OSGI-INF/pc-claims-demo-model.xml`, `bundle/schemas/*.xsd` | **The stand-in model:** two types, a search document, three page providers                                  | `app-model`                                                  |
| `content-model.json`                                               | The stand-in model as a server would answer it, which the pipeline holds the kit to                         | `app-model`                                                  |
| `package/`, `bundle/META-INF/MANIFEST.MF`, `build.mjs`             | The Marketplace package, the manifest, and version 1's builder, byte for byte                               | `app-package`, `app-model`                                   |
| `demo/pc-claims-connectors-config.xml`                             | The connector's contribution, for a server with the connectors add-on. Not packaged                         | By hand: no write tool writes one                            |
| `demo/registered.json`                                             | The connector's fields, as the pipeline's `--registered` takes them. Not packaged                           | By hand                                                      |
| `demo/seed.mjs`, `demo/data.mjs`, `demo/seed.selftest.mjs`         | The seed script, its fictional records, and its controls, the connector files' among them                   | By hand: the write tools write no code                       |
| `README.md`                                                        | This file                                                                                                   | `app-package`, then by hand: the write tools write no README |

- **No hand edit to a package file that stayed.** Every file under `bundle/`, `package/`,
  `build.mjs` and `content-model.json` was written by `apply_generator`, `write_package_file` or
  `apply_package_changes`, each of which answered `written: true`. One, the Edit form, was changed
  by hand for a moment, as a negative control of the designer's round trip, and put back byte for
  byte; one queue file was deleted by hand when its id changed, since no write tool removes a file
  (the log, below).
- **Every hand-edited app definition file is written as the layout designer writes it,** the
  repository's Prettier given the value on one line, so the designer's round trip holds each byte
  for byte. No file of the kit is in its `NOT_BYTE_FOR_BYTE` list.
- **No `actions.json`.** None was asked for: the claim's status is a property here, not a
  lifecycle, as the moves kit's is.
- **One version in three places:** 0.2.0, in `package.xml`, `app.json`'s `packageVersion` and the
  manifest's `Bundle-Version`.
- **Since 0.2.0, files written by hand,** each checked by the pipeline and the layout designer's
  round trip, written as the designer writes it:

| File                                                                                  | What it is                                                                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bundle/OSGI-INF/pc-claims-demo-capture.xml`                                          | The inbox and mail types, two page providers, and the capture profile `pc-claims-mail`                             |
| `bundle/agentic-ui-config/queues/mail-to-confirm.json`                                | Mail to confirm: what waits for a person, oldest first, with why, the class, the confidence and the claim proposed |
| `bundle/agentic-ui-config/layouts/PropertyClaimMail/edit.layout.json`                 | A piece of mail's Edit form: the decision, a note, the class, the fields, the claim                                |
| `bundle/agentic-ui-config/layouts/PropertyClaim/view.layout.json`                     | The claim page, with a card of the mail filed on it                                                                |
| `bundle/agentic-ui-config/home.json`, `navigation.json`, `labels/en.json`             | The home's figure of mail waiting, the menu's entry, and the labels, the `capt:` properties' among them            |
| `content-model.json`, `package/package.xml`, `bundle/META-INF/MANIFEST.MF`            | The two types and the add-on's facet in the model; the dependency on `nuxeo-agentic-capture:0.1.0`; the component  |
| `demo/letters.mjs`, `demo/claim-letter-pc-24003.pdf`, `demo/claim-letter-unclear.pdf` | The two fictional letters, and the script that writes them byte for byte                                           |
| `demo/mail-in.mjs`, `demo/mail-in.selftest.mjs`                                       | Demo step 3's intake, as a scanner, and its controls                                                               |

## The stand-in model

The local Nuxeo has no property claims model, and none was given, so the package carries a
fictional one in a component of its own, `pc-claims-demo-model.xml`, as the Payers and moves kits
do.

| Type             | Schema (prefix)              | What it holds                                                                                                                                               |
| ---------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PropertyPolicy` | `propertypolicy` (`ppolicy`) | `number`, `holder`, `holderEmail`, `holderPhone`, `propertyAddress`, `product`, `status`, `effective`, `expiry`, `coverageLimit`, `deductible`              |
| `PropertyClaim`  | `propertyclaim` (`pclaim`)   | `number`, `policy` (its policy's id), `lossDate`, `cause`, `lossLocation`, `lossDescription`, `reportedOn`, `status`, `adjuster`, `reserve`, `denialReason` |

- **`PropertyClaim` also has Nuxeo's `files` schema,** `files:files`, its attachments, from
  `app-model --attachments`. The type still opens as a record page: only the `file` and `note`
  schemas keep a record's own view (`OWN_VIEW_SCHEMAS` in `libs/shared/document-layouts`).
- **Statuses and causes are properties,** stored as the words the pages show: `pclaim:status` is
  `Reported`, `Investigating`, `Approved`, `Denied` or `Closed`; `pclaim:cause` `Fire`, `Water`,
  `Wind`, `Hail`, `Theft`, `Vandalism` or `Other`; `ppolicy:status` `In force`, `Lapsed` or
  `Cancelled`; `ppolicy:product` `Homeowners`, `Condominium`, `Landlord` or `Small business`. So
  the Edit form's rule names `Denied` as the request did. The types have the platform's default
  lifecycle, which nothing here reads.
- **The claim holds no copy of its policy's values.** Since #751 the page and the queues read the
  policy's number, holder and insured property from the policy, with `show` on its
  `document-link`, so nothing goes stale when the policy changes. The core system's card reads the
  claim's own number.
- **Not folders,** so each opens as a record page. No folder lists the types among its subtypes, so
  the Create menu does not offer them: the seed writes the records.
- **The names say what they are:** `PropertyPolicy` and `PropertyClaim`, with the prefixes `ppolicy`
  and `pclaim`. The server has `Claim` and `claim:` from the Payers kit and `DamageClaim` and
  `dmg:` from the moves kit, and a plain `Policy` would be the first name a real insurer's Studio
  project took.

| Page provider            | Given         | Returns                                                                                                                                                         | Reads            |
| ------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `pc_open_claims`         | Nothing       | Claims `Reported`, `Investigating` or `Approved`, oldest report first, with `pclaim_status_agg`, `pclaim_cause_agg`, `pclaim_adjuster_agg`, `pclaim_policy_agg` | The search index |
| `pc_high_reserve_claims` | Nothing       | The same open claims with a reserve over 50,000, largest reserve first                                                                                          | The repository   |
| `pc_policy_claims`       | A policy's id | Its claims, latest loss first                                                                                                                                   | The repository   |

- **The threshold is written in the page provider,** `pclaim:reserve > 50000`, and in the queue's
  and the home's labels, "$50,000": changing it is a change to the model and to two labels. A queue
  could give it as a parameter, but `app-model` quotes every parameter as text, and a quoted number
  compared with a `double` was not tried on a server.
- **The open claims lag a write by about a second:** only the search index answers aggregates,
  which the facets and the home's figures need.
- **Each aggregate has ten buckets,** as `app-model` writes them: an adjuster facet on a team of
  more than ten would show the ten with the most claims.

## The core system's card

Demo step 1's "live policy and payment data from the core system" is layout version 2's `external`
card ([layout-v2.md](../../../docs/business-apps/layout-v2.md), section 7, "Fields from another
system"), over the connectors add-on's `Connector.Read`
([its README](../../../nuxeo-agentic-connectors/README.md)), as staging has them.

- **The card names the connector and its fields, and nothing else:** `pcclaims.policyPayments`,
  and `policyStatus`, `policyNumber`, `deductibleMet`, `paymentStatus`, `paidAmount`, `paidOn` and
  `paymentReference`, each with its widget: `status-badge` with a tone for each status, `boolean`,
  `currency` in USD, `date`. No address, key or credential is in it, which the validator refuses.
- **The connector's contribution is `demo/pc-claims-connectors-config.xml`,** not the bundle. It
  reads `PropertyClaim` records, keyed on `pclaim:number`, at `/claims/{key}`, the stand-in core
  system's path, with the fields at the pointers its answers have, as the add-on's own demo
  connector, `payers.claimPayments`, does. The address and the token are server settings,
  `nuxeo.agentic.connectors.pcclaims.policyPayments.address` and `.token`, or the environment's
  `NUXEO_CONNECTOR_PCCLAIMS_POLICYPAYMENTS_TOKEN`. **Why not in the bundle:** the contribution
  requires `org.nuxeo.agentic.connectors`, which has no Marketplace package yet, so a kit cannot
  depend on it, and a bundle carrying it would leave a component pending on every server without
  the add-on. On a demo server that has the add-on, the file goes in `nxserver/config/`, as the
  add-on's own demo connector does ([below](#connecting-the-core-system)).
- **`demo/registered.json`** lists the connector's fields for the pipeline: with
  `--registered`, it refuses a card field the connector does not return and an unknown connector
  (step 3 below, each seen failing). Without it, as CI and the write tools run, the card is held to
  its form only. The pipeline never reads the contribution itself, so the seed's controls hold the
  three files to each other: the card's fields are the contribution's, `registered.json` lists
  exactly them, and the key is a property the model gives the type.
- **The stand-in core system has no record for this kit's claims.** `core-system.mjs` answers the
  Payers seed's claim numbers only, so on a server with the add-on, the contribution, its settings
  and the stand-in all in place, the card would say "Nothing found in the other system" for every
  one of the eight. With the kit alone, `Connector.Read` does not exist, and the card shows its
  error state. Not changed here: another change is editing the
  add-on, and the kit only configures it. Its follow-up is eight records of the same shape for
  `PC-24001` to `PC-24008` (feedback item 4, below).
- **The connector's key is the claim number,** which the Edit form shows read-only, so the form
  cannot point the card at another claim's record. **That is a convenience, not a control,** and
  the exposure is wider than the form: the REST API still writes the number, and **anyone who may
  create a `PropertyClaim` anywhere, their own personal workspace included, may give it any number
  and read that claim's core-system record through the card.** The kit does not limit where its
  types may be created (no folder lists them, which hides them from the Create menu only), so the
  server's check of the reader's `Read` on the claim, which comes first, protects nothing here: the
  reader made the claim. The connectors README's security review says to key a connector on a
  property a workflow or an import writes and to limit where its types may be created; a real kit
  must do both. **Accepted for this demo,** whose core-system data is fictional, and left for the
  connectors' security review; the card is never a security control.

## Photos and documents

The claim's attachments are `files:files`, which `app-model --attachments` gave the type.

- **On the claim page,** the "Photos and documents" card lists them with `file-list`, which shows
  each file's name until it has its lookup (layout-v2.md, section 11).
- **The preview is the document page's,** beside the record page: its Attachments panel lists the
  same files with a preview button each, which fetches the file through the application and shows
  a picture or a PDF in a dialog (`AttachmentPreviewDialogComponent`, in
  `libs/features/document-detail`), and uploads one for anyone who may write the claim. No layout
  key draws a preview on the record page itself; `file-list` has no parameter for one.
- **The seed never writes `files:files`,** so a photo filed on a claim stays through a second run.
  Nothing here has been tried with a photo: no server has the package.

## Capture: the mail inbox

Since 0.2.0, on [`nuxeo-agentic-capture`](../../../nuxeo-agentic-capture/README.md) 0.1.0, which
`package.xml` depends on. Its component, `pc-claims-demo-capture.xml`, is the kit's own, apart from
the model `app-model` writes, as the onboarding kit's signature component is.

| Type                 | What it is                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `PropertyClaimInbox` | The claims mail inbox, a folder that takes only mail. The demo's is `/default-domain/workspaces/pc-claims-demo/inbox`                 |
| `PropertyClaimMail`  | A piece of mail: its file, `file:content`, and the add-on's `CaptureItem` facet, `capt:`. It opens on its file, beside its properties |

**The profile,** `pc-claims-mail`: mail in a `PropertyClaimInbox` is filed on a `PropertyClaim`
under the kit's workspace, by itself at a confidence of 85% and above.

- **One class, a claim letter,** known by three phrases, "claim number", "policy number" and "date
  of loss", which the stand-in counts: a letter with the three is a claim letter at 100%, with two
  at 67%, below the threshold.
- **Its fields:** the claim number, the key, matched to `pclaim:number`, of the form `PC-` and five
  digits; the policy number, of the form `POL-PC-` and four digits; the date of loss; and who it is
  from. Only the claim number decides where a letter is filed: the others are kept, with their
  confidence, for the adjuster.

| Where                        | What it shows                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mail to confirm**, a queue | What waits for a person, oldest first: the mail, why it waits, the class proposed, the confidence, the claim proposed by its number, when it came in. Page provider `pc_capture_review`, from the repository, so no lag |
| The home                     | "Mail waiting for a person", a figure that opens the queue                                                                                                                                                              |
| A piece of mail              | Its letter, and its properties under "Capture". Its Edit form: the decision, a note, the class, the fields as a table, the claim; each read-only once it is filed or rejected                                           |
| The claim page               | "Mail filed on this claim": each piece of mail filed on it, its class, its confidence, how it was filed, by whom and when. Page provider `pc_claim_mail`                                                                |

- **Confirm or correct, in the Edit form:** type `confirm` in Decision and save, with the class,
  fields and claim as proposed, or corrected first. A corrected claim number is matched again; a
  claim named is held to the letter's number. `reject` sets it aside. The server checks each
  ([the add-on's README](../../../nuxeo-agentic-capture/README.md#the-persons-part)), and files only
  on a claim the adjuster may write.
- **Who may:** the inbox's permissions. Whoever may add to it uploads; whoever may write it
  decides; filing needs the claim's write too. The seed sets none: an administrator gives the
  adjusters `ReadWrite` on the inbox, and a scanner's account `AddChildren`.
- **Seeing the queue is not a security control:** the server checks who may decide and file.

## Demo step 3: a scanned claim letter filed on its claim

With both packages installed and the stand-in configured
([the add-on's README](../../../nuxeo-agentic-capture/README.md#installing-it-on-the-local-docker-nuxeo-for-the-demo)),
the kit seeded, and the adjusters given `ReadWrite` on the inbox and on the claims, since a
confirm files only on a claim the adjuster may read and write. **Not run:** no server has either
package.

1. **The letters come in,** as a scanner sends them: from the repository's root,
   `NUXEO_USER=<a user who may add to the inbox> NUXEO_PASS=… node business-apps/packages/pc-claims-demo/demo/mail-in.mjs`.
   It creates the inbox when it is not there, puts each letter into it, and says what the capture
   made of each.
2. **Filed by itself:** `claim-letter-pc-24003.pdf`, from Calder and Finch Bakery, is a claim letter
   at 100%, its claim number PC-24003, its policy POL-PC-1002. On PC-24003's page, the letter is
   among the photos and documents, and in "Mail filed on this claim", automatic, 97%; its history
   says it was filed from the inbox.
3. **Waiting for a person:** `claim-letter-unclear.pdf`, from Ottoline Brandt, read badly: no policy
   number, and its claim number read `PC-24O08`, with a letter O. It is in **Mail to confirm**, "low
   confidence", 0%, with no claim proposed.
4. **An adjuster corrects it:** opens it, reads the letter, and in its Edit form corrects the claim
   number to `PC-24008` and types `confirm`. It is filed on PC-24008, corrected, by the adjuster,
   and leaves the queue.

The letters are the kit's: `letters.mjs` writes them, byte for byte, and the add-on's
`KitLetterTest` reads them with the stand-in and this profile, as the server would.

## How it was built: the log

Run on 26 November 2026, from 20:03 to 21:16 IST, before the pull request, in a worktree of
`staging/enterprise-grade-app` at `cc9afbb66`, on Node 24.22.1 (Node 25.2.0 for `npm ci`, a
departure: step 0), as the skill's agent. The agent spoke to the Builder MCP server over stdio,
as Claude Code does once the server is registered, through a small client of its own outside the
repository, as the contracts and moves kits' runs did:
registering the server with `claude mcp add-json` changes the person's own Claude configuration,
which was not asked for. **Nothing was written to any Nuxeo, and nothing was read from one** (step
1). The times are the agent's, from its commands' timestamps.

### Step 0. Before you start (20:03, 2 minutes)

| What                               | Result                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci`                           | Passed in 69 seconds, on Node 25.2.0 with `NODE_OPTIONS=--no-experimental-webstorage`. `package-lock.json`'s SHA-256 unchanged. **A departure:** the shell's default Node, not the 24 the skill asks for; allowed by the request, with that option. Everything after ran on 24 |
| Node for the rest                  | 24.22.1, the major `.nvmrc` pins, for the MCP server, the generators, the pipeline and the seed                                                                                                                                                                                |
| `NUXEO_USER`, `NUXEO_PASS`         | **Not in this run's environment.** The agent did not supply an account of its own (step 1)                                                                                                                                                                                     |
| A server whose model may be shared | The local Docker Nuxeo, running (`/nuxeo/runningstatus` answered 200, unauthenticated), never read                                                                                                                                                                             |
| The platform version               | `0.2.0`, from `libs/platform/package.json`                                                                                                                                                                                                                                     |

Reading the plan, the skill, the moves and contracts kits' READMEs, the connectors README,
layout-v2.md's sections 2 to 7 and 12, and app-definition-v2.md's queues took about 8 minutes;
writing the client, 1 more.

### Step 1. Read the server (20:12, 1 minute)

| Asked                                                                                                                                                                                                                       | Answer                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_content_model`, `describe_document_type` `PropertyClaim`, `describe_page_provider` `pc_claims_open` (a name planned then; the kit's is `pc_open_claims`), `list_page_providers`, `list_vocabularies`, `list_workflows` | Each refused at once: "NUXEO_USER and NUXEO_PASS must both be set in the server's environment … There is deliberately no default"                                            |
| `get_content_model` and `describe_schema` `files`, given the moves kit's folder                                                                                                                                             | Answered from its `content-model.json`, `source: "package"`: `files:files`, `complex[]` of `{ file: blob }`                                                                  |
| The seven kits' own models, read from their folders                                                                                                                                                                         | Their types and prefixes: `Claim` and `claim`, `DamageClaim` and `dmg`, `Contract` and `contract`, and the rest. No `PropertyClaim`, `PropertyPolicy`, `pclaim` or `ppolicy` |

**A departure:** the skill's step 1 reads the server, and this run could not. The server reads
need an account, and the run's environment had none; the agent did not sign in with one of its own
choosing. So the names were checked against the other kits' models instead, and later against
every kit as a set by the release candidate (below), which found a clash the reads would not have.
What the reads would have added: the server's own stock names, which a stand-in model's names
could shadow, and the NXQL tried read-only, which the pipeline's token check replaces only in part.

**The skill says to stop here:** the types do not exist, and creating them is Studio's. The
request asked for a demo kit with a stand-in model, so the kit carries one, written by `app-model`.

### Step 2. Write the files, through the write tools only (20:13, 6 minutes, then 1 at 20:36 and 1 at 21:00)

Three writes from 20:13 to 20:19, each answering `written: true`, two more later, after the release
candidate and after the review, and two refused on purpose, as negative controls of
the write tools, which show that a refusal leaves the package as it was; they are not evidence
that the kit is right, which the rest of this log is.

| Call                                                                                                                                                                                                                                                                                                                                                                                                                        | Answer                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apply_package_changes`, 9 changes: `app-package` (no `type`, `appId: pc-claims`, `address: property-claims`, two groups); `app-model` for `PropertyPolicy`, and `PropertyClaim` with `attachments`; `app-model` for the three page providers, the open claims' with `aggregates: "pclaim:status,pclaim:cause,pclaim:adjuster"`; `app-layout` for the two types; `app-form` for the claim's Edit form with seven `required` | `written: true`, 17 files, in 6.3 seconds. One card per type, every property in the model's order. "Left out" named `files:files` for the claim, "a file-list widget shows them on the record page, written by hand"                                                             |
| `apply_package_changes`: `labels/en.json` first, then the three layouts, whole                                                                                                                                                                                                                                                                                                                                              | `written: true`, 4 files, in 0.5 seconds: 3 layouts held to the content model, 5 files passed                                                                                                                                                                                    |
| `write_package_file`: the claim page with the core system's card naming `ppolicy:number`, a property, as a connector field                                                                                                                                                                                                                                                                                                  | **Refused, on purpose:** step 2, `cards[3].external.fields[1].name: a field of another system is named as its connector names it` [structure]. The file's SHA-256 unchanged                                                                                                      |
| `apply_package_changes`: `app-queue` twice, then `labels/en.json`, the two queues with their widgets and facets, `home.json` and `navigation.json`, whole, then `app-registry`                                                                                                                                                                                                                                              | `written: true`, 5 files, in 3.5 seconds: 9 files passed. `app-registry`: "Now names: home.json, navigation.json"                                                                                                                                                                |
| `write_package_file`: the open claims queue with a fourth facet, `pclaim_policy_agg`                                                                                                                                                                                                                                                                                                                                        | **Refused, on purpose:** step 2, `facets[3].aggregate`: the page provider "has no aggregate "pclaim_policy_agg": it defines pclaim_status_agg, pclaim_cause_agg, pclaim_adjuster_agg". The review later asked for that facet, and `app-model` wrote the aggregate (the last row) |
| After the release candidate (below): `apply_package_changes`, `app-queue` `open-property-claims`, then `labels/en.json`, that queue, `home.json` and `navigation.json`, whole, then `app-registry`                                                                                                                                                                                                                          | `written: true`, 5 files, in 1.3 seconds. `app-queue`: "now names queues/open-property-claims.json, and no longer names queues/open-claims.json"                                                                                                                                 |
| After the review (below): `apply_package_changes`, `app-model` for `pc_open_claims` again, `force`, with `aggregates: "pclaim:status,pclaim:cause,pclaim:adjuster,pclaim:policy"`; then `labels/en.json`, the two queues, `home.json` and `navigation.json`, whole: a Policy facet with `"widget": "document-link"`, and the high-reserve queue and its menu entry for managers, as its figure was                          | `written: true`, 6 files, in 11.9 seconds: the model component and the search schema written again with `pclaim_policy_agg`                                                                                                                                                      |

The edits, written with `write_package_file` from layout-v2.md and app-definition-v2.md, each file
the designer's bytes for its value:

- **The claim page,** from the generator's one card: the claim (number, summary, status, adjuster,
  reserve), the loss (date, cause, where, what happened, the report day and the days between), the
  policy (its link, and its number, holder and insured property through `show`), the core system's
  card, the photos and documents, the denial and the history. Widgets a person would pick:
  `status-badge` with a tone for each status, `currency` in USD, `date`, `user`, `long-text`, and
  `document-link` with `types: ["PropertyPolicy"]`, which the generator could not choose (feedback,
  below).
- **The banners,** each a registered rule: reported late,
  `app.rules.dateAfter` of `pclaim:reportedOn`, `pclaim:lossDate` and 30; denied,
  `app.rules.fieldIn`. On the policy: not in force, `fieldIn` with `Lapsed` and `Cancelled`; ending
  within 30 days, `core.every` of `fieldIn` `In force` and `app.rules.dateWithin` 30.
- **The policy page:** the policy, the holder (`phone`, `email`), the coverage (`currency`), its
  claims as a related list of `pc_policy_claims` given its `ecm:uuid`, and the history.
- **The rule in plain words,** "a denial reason is required when the status is Denied": `required`
  is for forms only, so on the Edit form's `pclaim:denialReason`, as
  `{ "type": "app.rules.fieldIn", "parameters": [{ "field": "pclaim:status" }, "Denied"] }`. **The
  check:** `core.notBefore` on `pclaim:reportedOn`, given `pclaim:lossDate`: the report is not
  before the loss, which is the loss not after the report. **The claim number** read-only there,
  with `readOnlyWhen` `core.true` (the core system's card, above).
- **The queues' widgets and facets,** the policyholder column through `show`, the home and the
  menu, which have no generator.

### Step 3. Check them: every write already did (20:19, 2 minutes)

| Check                                                                                                                                                                                                           | Result                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run app-package -- business-apps/packages/pc-claims-demo --platform 0.2.0 --model business-apps/packages/pc-claims-demo/content-model.json`                                                                | Passed: 3 layouts held to the model, 9 files passed, the last write's SHA-256                                                                                                                            |
| The same without `--model`, as CI runs it                                                                                                                                                                       | Passed, the same SHA-256. Not more evidence: a kit with a stand-in model is held to its own `content-model.json` either way                                                                              |
| The same with `--registered business-apps/packages/pc-claims-demo/demo/registered.json`                                                                                                                         | Passed, the same SHA-256                                                                                                                                                                                 |
| `--registered` without `paymentReference`, and with the add-on's own `registered.json`, which has the Payers connector only                                                                                     | **Refused, each:** `cards[3].external.fields[6].name: the connector "pcclaims.policyPayments" does not return the field "paymentReference"`; `the connector "pcclaims.policyPayments" is not registered` |
| `validate_package`, and with `registered`                                                                                                                                                                       | `passed: true`, `asCi: true`, no finding; with `registered`, `asCi: false`, `departsFromCi: ["registered"]`, the same SHA-256                                                                            |
| By hand, what the pipeline does not check (skill, step 3): every property a field, a column, a sort, a rule, a computation, a check or a `show` names, against its type, its page provider's or the linked type | 81 references, none missing. Seen failing: `pclaim:reportedDate` in the late-report banner's rule and `ppolicy:holderName` in a queue's `show`, both named                                               |
| The pipeline on that broken copy                                                                                                                                                                                | **Refused the `show`,** since #751, and **passed the rule:** a banner whose rule names a property the type does not have would never show (feedback, below)                                              |

### Step 4. Preview in dev mode, as far as it goes (20:21 and 21:04, 1 minute each)

| What                                                                     | Result                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview_package`, `DEV_SERVER_URL=http://localhost:4299`, no dev server | `served: true`: the home, the menu, the two queues, the labels, the three layouts; `app.json` not served, as the registry's. `devServer.answering: false`. The Edit form is named "the PropertyClaim Edit form" |
| `preview_package` again, after the queue's new id and the review's edits | `served: true`, the package as committed: `queues/open-property-claims.json` and `queues/high-reserve.json`, the old `open-claims` gone from the dev folder, and the rest as above                              |
| The dev server and the pages in a browser                                | **Not started, not seen.** The person signs in to the app with their own account, and this run had none; no server holds a `PropertyClaim` or a `PropertyPolicy` either                                         |

What a browser would show is what the contracts, facilities and moves kits' runs saw for a kit no
server has: the home's figures "Unavailable" and each queue's error state, since the server has
none of the three page providers. The pages to open are `#/home`, `#/queues/open-property-claims`
and `#/queues/high-reserve`. The layouts are held instead by the layout designer's round trip,
which opens each, and by the pipeline.

### Step 5. Publish to pre-production

**Not done, and not built in the MCP server.** No `app-package/*` tag was pushed. The kit is not
installed anywhere.

### The seed and the connector's files (20:19 and 20:21, 9 minutes)

Written by hand: the write tools refuse `demo/*`, as code, and write no connector contribution. On
the moves kit's seed. Its controls, `node business-apps/packages/pc-claims-demo/demo/seed.selftest.mjs`,
**38 of 38 passed**. Broken on purpose seventeen ways, one at a time, in a scratch copy, each turned
at least one control red: no type precondition, no check that `/me` answers a user, a claim linked
to its policy by number instead of id, no wait for the search index, no check of the facets, no
order check, a claim's attachments written over, an emptied denial reason not emptied, the Basic
header printed, no parameter given to the policy's claims, any trashed name like a record's
restored, no write over an existing record, `registered.json` missing a field, the connector keyed
on a property the model lacks, an address in the contribution, the claim reported on the 30th day
moved to the 31st, and, after the review's Policy facet, a policy's bucket looked for by its number
instead of its id.

### The lists of kits, and the release candidate (20:28, 11 minutes)

- **The two lists of kits.** `npm run app-definition:server-validator` rebuilt the server
  validator's parity corpus with the kit, and the administrator guide has its rows: section 1's
  table of packages, the table of the app registry's groups, the README's link, the seeds that
  create no group, and the seeded workspaces. `kit-lists.spec.ts` passed, and failed with the
  corpus as staging had it and with the groups row removed, naming the kit each time.
  `DeploymentValidatorParityTest` passed with Maven, on JDK 21. The kit was added to the lists of
  kits found in `kit-lists.spec.ts` and `kit-schema-labels.spec.ts`, which passed.
- **The designer's round trip,** `round-trip.spec.ts`, holds the kit's five files, 55 tests, each
  byte for byte. Seen failing with one Edit form field written across four lines, as `app-form`
  writes it, and put back.
- **`npm run app-package:selftest`:** 124 negative controls refused and 37 sound packages built.
- **The release candidate,** `node scripts/release-candidate.mjs --out /tmp/pc-claims-agent/rc-1 --since origin/staging/enterprise-grade-app`,
  **refused the kit at stage 3, the kits as a set:** "the queue open-claims is contributed by
  moves-demo and pc-claims-demo". Nothing before it had said so: the write tools and the pipeline
  hold one package at a time. The queue was given the id `open-property-claims` through the write
  tools (step 2's sixth row). **A departure:** the old file, `queues/open-claims.json`, was deleted
  by hand first, since no write tool removes a file; the same call's `app-queue` took it out of the
  component. The parity corpus was written again. **Run again,** from 20:36 to 20:39, the
  candidate was assembled whole: stage 3 compared the kit's 21 names with the other seven kits' and
  found no clash, and Maven's packages and tests passed, before the review's edits below. Nothing
  was signed, tagged or published.

### The gate, the pre-PR review and the independent review (20:40, 33 minutes)

- **The gate,** `npm run beta:gate -- --base origin/staging/enterprise-grade-app --gates
lockfile,guardrails,sanitizer-audit,lint,test,spec-types,api-surface,reference-drift,published-links,module-boundaries,agent-mirror`:
  11 of 11 passed at 20:43, in 2.5 minutes, and 11 of 11 again at 21:13, in 5 minutes, after the review's edits.
- **`node scripts/pre-pr-review.mjs --base origin/staging/enterprise-grade-app`:** no mechanisable
  defect, on 8 changed files. Its skill's judgement classes, worked by hand, renamed one control
  that claimed more than it checked: "no address and no credential" became "writes no address,
  and names its address and its token by server settings".
- **A reviewer agent,** given the request, the skill and the documents, and not this log, read the
  kit and its diff, ran the pipeline, the controls, the specs and checks of its own, and found
  nothing blocking. Its property walker found the same 81 references, none missing; it recomputed
  the seed's expected orders and buckets from the model's NXQL, and they matched. What it found,
  and what was done:

| Finding                                                                                                                | Done                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The log's end time was a placeholder, and steps 1 and 2 both began at 20:13                                            | Filled in; step 1 began at 20:12, with the client                                                                                                                           |
| The administrator guide still said no kit contributes a connector, and named only `deployment/` for `nxserver/config/` | Both items of its install order now name this kit's connector file                                                                                                          |
| The connector's key exposure was understated: anyone who may create a `PropertyClaim` anywhere picks the record read   | Said plainly in "The core system's card", as an accepted risk of the demo for the connectors' security review                                                               |
| Step 4's preview predated the queue's new id, and left the dev folder serving `open-claims`                            | `preview_package` run again; its row added                                                                                                                                  |
| Node 25 for `npm ci` was recorded, not called a departure                                                              | Called one, with why                                                                                                                                                        |
| The release candidate's command had no `--out`, which it requires                                                      | Given                                                                                                                                                                       |
| Step 1 named `pc_claims_open`, a page provider the kit does not have                                                   | Said so: a name planned before the kit was written                                                                                                                          |
| "The card would say Nothing found" holds only with the add-on, the contribution and the stand-in in place              | Said: with the kit alone, the card shows its error state                                                                                                                    |
| The high-reserve figure was for managers, its queue and menu entry for everyone                                        | The queue and its entry given the same `visibleWhen`, through the write tools                                                                                               |
| #751's facets by title were not used, nor said to be considered                                                        | A Policy facet on the open claims, `pclaim_policy_agg` with `"widget": "document-link"`, through `app-model --force` and the write tools; the seed checks its buckets by id |

After the edits: the pipeline, with `--model` and `--registered`, passed; the controls passed, 38 of
38, and the seventeen breaks each turned one red; the parity corpus was written again and
`DeploymentValidatorParityTest` passed; the round trip held the kit's files, 55 tests.

### 0.2.0: capture, by hand (27 November 2026)

Not the skill's steps, and **not through the write tools**: the capture add-on's types, facet,
profile and page providers are a component no generator or write tool writes (feedback items 18
and 19, below), and the session that built the add-on had no Builder MCP server connected. So each
file in [What is in it](#what-is-in-it)'s 0.2.0 table was written by hand, formatted with the
repository's Prettier, and then held to the pipeline, `--previous` 0.1.0 as staging had it
([Building it](#building-it)), to the layout designer's round trip and the kits' lists
(`npx nx run-many -t test -p shared-app-definition layout-designer`), and to the server
validator's parity corpus, written again with `npm run app-definition:server-validator`. Nothing
was written to any Nuxeo, and nothing was read from one.

## Building it

```bash
npm run app-package -- business-apps/packages/pc-claims-demo --platform 0.2.0
```

It writes `dist/pc-claims-demo-0.2.0.zip`, held to the package's own `content-model.json`, since it
ships a stand-in model. Held to the version before it, as CI holds a pull request to its base:

```bash
mkdir -p /tmp/base
git archive origin/staging/enterprise-grade-app business-apps/packages/pc-claims-demo | tar -x -C /tmp/base
npm run app-package -- business-apps/packages/pc-claims-demo --platform 0.2.0 \
  --previous /tmp/base/business-apps/packages/pc-claims-demo
```

On 27 November 2026, against 0.1.0: 4 layouts held to the model, 11 files passed, 41 changes, which
need a patch, and 0.2.0 raises the minor, since the package now needs a domain module's add-on,
`nuxeo-agentic-capture`, which a server without it cannot install. To hold the core system's card
to its connector too:

```bash
npm run app-package -- business-apps/packages/pc-claims-demo --platform 0.2.0 --registered business-apps/packages/pc-claims-demo/demo/registered.json
```

## Installing it on a local Nuxeo

**Not run.** Installing is a person's decision. Written from the moves kit's install, which follows
the Payers kit's, the one that ran on the same container: the local Nuxeo is the Docker container
`nuxeo`, on port 8080, with `nuxeo-agentic-ui` already installed. **Since 0.2.0, install
`nuxeo-agentic-capture` 0.1.0 first** ([its README](../../../nuxeo-agentic-capture/README.md#installing-it-on-the-local-docker-nuxeo-for-the-demo)):
the package depends on it, and its model names the add-on's facet.

**1. Build it,** as above. **2. Copy it into the container,** then a one-off script that installs
it when the container next starts, and removes itself: `nuxeoctl mp-install` refuses while the
server runs, and the server is the container's main process.

```bash
docker cp business-apps/packages/pc-claims-demo/dist/pc-claims-demo-0.2.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/pc-claims-demo-0.2.0.zip --accept=true > /var/log/nuxeo/pc-claims-kit-install.log 2>&1 || echo "pc-claims kit: install failed, see /var/log/nuxeo/pc-claims-kit-install.log"' 'rm -f "$0"' > /tmp/zz-pc-claims-kit-install.sh && chmod 755 /tmp/zz-pc-claims-kit-install.sh
```

```bash
docker cp /tmp/zz-pc-claims-kit-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

**3. Check it.**

- `/var/log/nuxeo/pc-claims-kit-install.log` lists the package installed, and the server log's
  `Component Loading Status` has nothing pending or missing.
- `/nuxeo/agentic-ui-config/layouts.json` lists `PropertyClaim` and `PropertyPolicy` in `view`
  mode, and `PropertyClaim` in `edit` mode.
- The MCP server's `describe_document_type` `PropertyClaim` lists `files:files`, and
  `describe_page_provider` `pc_open_claims` its three aggregates, from the server.
- The content model the server answers is `content-model.json`'s:

  ```bash
  npm run app-package:model -- --server http://localhost:8080/nuxeo --out tmp/pc-claims-model.json
  ```

  ```bash
  npm run app-package -- business-apps/packages/pc-claims-demo --platform 0.2.0 --model tmp/pc-claims-model.json
  ```

### Connecting the core system

**Not run, and not useful yet:** the stand-in core system has no record for this kit's claims
([above](#the-core-systems-card)). For a server that has the kit and the connectors add-on
installed (the add-on's README, "Installing it on the local Docker Nuxeo"), in the shell that
holds a made-up demo token:

```bash
docker cp business-apps/packages/pc-claims-demo/demo/pc-claims-connectors-config.xml \
  nuxeo:/opt/nuxeo/server/nxserver/config/pc-claims-connectors-config.xml
export CORE_SYSTEM_TOKEN=$(openssl rand -hex 16)
umask 077
P=nuxeo.agentic.connectors.pcclaims.policyPayments
printf '%s.address=http://host.docker.internal:8091\n%s.http.allowed=true\n%s.token=%s\n' \
  "$P" "$P" "$P" "$CORE_SYSTEM_TOKEN" > /tmp/70-pc-claims-connector.conf
docker exec -i nuxeo sh -c 'cat >> /etc/nuxeo/nuxeo.conf' < /tmp/70-pc-claims-connector.conf
rm /tmp/70-pc-claims-connector.conf
docker restart nuxeo
node nuxeo-agentic-connectors/demo/core-system.mjs
```

`http.allowed` is for the demo's plain `http` stand-in only. Not `/etc/nuxeo/conf.d/` on a
container that has started before: the add-on's README says why.

These three are all the connector needs. Since the add-on's version 0.1.0, a server may also keep
its answers, `$P.cache.ttl` in seconds, and take the core system's change events, `$P.events.secret`;
neither is set here, so every card drawn asks the core system, as before (the add-on's README,
"The cache" and "Change events").

### Removing it

**Not run.** **First delete the seeded workspace,** `/default-domain/workspaces/pc-claims-demo`,
and empty it from the trash: a document whose type is gone cannot be read. Then a one-off script,
as for the install, with `nuxeoctl mp-remove pc-claims-demo --accept=true`; and, if it was
connected, the connector's file in `nxserver/config/` and its three lines in `nuxeo.conf`.

## Seeding it

With the package installed and Nuxeo running, from the repository's root:

```bash
export NUXEO_USER=<administrator> NUXEO_PASS=<password>
```

```bash
node business-apps/packages/pc-claims-demo/demo/seed.mjs
```

- **What it writes:** five policies and eight claims, under
  `/default-domain/workspaces/pc-claims-demo`, in `policies` and `claims`, each named by its
  number. Dates are counted from the UTC day it runs, so the queues and banners hold the same
  records whichever day that is:
  - **open claims:** PC-24008, PC-24001, PC-24004, PC-24003, PC-24002 and PC-24007, oldest report
    first. The Status facet: two each of `Reported`, `Investigating` and `Approved`; Cause of loss:
    two `Fire`, two `Water`, one `Wind`, one `Hail`; Adjuster: two for `noor.halvorsen`, one each
    for `tobias.renner` and `imani.castell`, and two claims with none; Policy, by each policy's
    title: two on POL-PC-1001, one each on POL-PC-1002 and POL-PC-1003, two on POL-PC-1005;
  - **reserves over $50,000:** PC-24003 (140,000), PC-24001 (85,000) and PC-24008 (52,000);
  - **reported late:** PC-24003, 38 days after the loss, and PC-24006, 50, show the banner;
    PC-24005, reported on the 30th day, does not;
  - **PC-24005 is denied,** with its reason, and PC-24006 closed;
  - **POL-PC-1003 ends in 25 days** and **POL-PC-1004 has lapsed:** each policy page shows its
    banner. POL-PC-1001 lists two claims.
- **No user and no group.** The kit's groups and the people in them are the server's to decide.
  The adjusters are user names only, so the `user` widget shows the name as stored, and so does the
  Adjuster facet, which takes no `user` widget.
- **Links are ids,** written in order: the policies, then the claims with their policy's id.
- **It never writes a claim's attachments, and never calls the core system.**
- **Safe to run twice,** as the moves kit's seed: a record already there is put back to
  `data.mjs`'s values, a property the data leaves empty emptied, a trashed one restored and put
  back, a trashed document whose name only looks like a record's left in the trash, two trashed
  copies of one stop the run, and a place holding a document of another type stops the run,
  untouched.
- **It checks what it wrote:** the three page providers must return every seeded record that
  belongs in them and none that does not, in their order, the policy's claims given each policy's
  id; the open claims are asked again until the search index agrees, up to `NUXEO_INDEX_WAIT_MS`
  (15 seconds by default), and their four facets must count at least the seeded open claims, the
  Policy facet's buckets found by each policy's id.
- **What it needs:** Node 24, nothing to install. `NUXEO_USER` and `NUXEO_PASS` have no default.
  `NUXEO_URL` defaults to `http://localhost:8080`. Exit 2 means a precondition is not met, before
  anything is written: no credentials, no server, or one that answers `/me` with an error, with
  something that is not JSON, or with no user, credentials refused, either type missing, or no
  `/default-domain/workspaces`.
- **Its controls** run it against a stand-in for the REST API: they prove the script, not the
  server. CI does not run them. 38 controls, each behaviour above among them, one that no run
  prints a password or its Basic header, two on the data as this README describes it, and three
  that hold the connector's files to each other and to the model.

It prints the home, the two queues, a policy with two claims, the late claim and the denied claim,
on the app at `APP_URL` (`http://localhost:4200` by default).

## What a server shows, and what the dev server does

| Part                         | Served by the package on a server     | Under `config:dev`                    |
| ---------------------------- | ------------------------------------- | ------------------------------------- |
| The model and page providers | Yes                                   | From the server, so not yet           |
| The three layouts            | Yes, to everyone                      | Yes                                   |
| The home, menu, queues       | From the registry, to the two groups  | Yes, and they win over the registry's |
| `labels/en.json`             | From the registry, to the two groups  | Yes, and it wins over the registry's  |
| `app.json`                   | From the registry: it lists the app   | No                                    |
| The connector                | No: `demo/`, by hand, with the add-on | No                                    |

Seeing an app is not a security control: Nuxeo's permissions still decide which claims and
policies anyone reads, and the seed sets none, so its workspace has the server's defaults. A hidden
card or banner hides nothing from the REST API, and the connector returns its fields to anyone who
may read the claim.

## Phase 7 feedback: where the tools fell short

What the build met, in the order it met it. **Nothing was changed outside the kit** but the lists
of kits the skill says to join, and two specs' lists of kits found; each item is a follow-up
candidate. Items the moves kit raised that are fixed now are at the end.

1. **Step 1 cannot run without an account in the agent's environment,** and the skill says what to
   do only when the type is missing, not when the server cannot be read. The names were checked
   against the other kits' models by hand, and the clash that mattered was found only by the
   release candidate (item 7). Candidate: the skill saying what to check instead, and a read of
   every kit's names that the write tools run.
2. **No write tool writes a connector's contribution,** and the bundle could not carry one anyway:
   it requires `org.nuxeo.agentic.connectors`, which has no Marketplace package for a kit to
   depend on, so it would leave a component pending on a server without it. The contribution is a
   hand-written file in `demo/`. Candidates: a package for the add-on, and an `app-connector`
   generator writing a kit's connector component.
3. **The write tools hold an `external` card to its form only.** They take no `registered` file,
   though `validate_package` and the pipeline do, and the pipeline never reads a kit's own
   connector contribution: the card, the contribution and `registered.json` agree only because the
   kit's controls hold them to each other. Candidate: the pipeline reading a kit's connector
   contributions, as it reads its page providers.
4. **The connectors' stand-in core system knows only the Payers seed's claims,** so this kit's card
   would say "Nothing found" on a server for every claim, and demo step 1 cannot be shown with it.
   Candidate: records for `PC-24001` to `PC-24008`, of the shape the stub already answers, in
   `nuxeo-agentic-connectors/demo/core-system.mjs`, with a control.
5. **The pipeline does not check the properties a rule or a computation names,** even against a
   demo kit's own model: `pclaim:reportedDate` in the late-report banner's `dateAfter` passed it,
   and the banner would never show (package-pipeline.md, section 7, says so). A `show` naming a
   missing property is refused since #751. Candidate: rules', computations' and checks' properties
   held to the model where it is known, as columns and `show` are.
6. **The generators' JSON is not the designer's.** `app-form` writes `{ "field", "required": true }`
   across four lines and `app-queue` its sort across four, which the designer writes on one; a kit
   keeping either unedited fails the round trip byte for byte, as the facilities kit's Edit form
   does (`NOT_BYTE_FOR_BYTE`). This kit's files were rewritten as the designer writes them, by the
   agent's own formatting. Candidate: the generators writing JSON with the designer's writer.
7. **A name another kit has is found only by the release candidate.** The queue id `open-claims`,
   the moves kit's too, passed every write and the pipeline, which hold one package at a time.
   Candidate: the write tools, or the pipeline's step 2, comparing a kit's names with the other
   kits under `business-apps/packages/`, as the release candidate's stage 3 does.
8. **No write tool removes or renames a file.** Changing the queue's id meant deleting its file by
   hand. `app-queue` then took the old one out of the component itself. Candidate: a `remove`
   change in `apply_package_changes`, held to the files the write tools write.
9. **`validate_package` and `preview_package` take `directory`;** the write tools and the readers
   take `package`. The first `validate_package` call, with `package`, was refused as invalid input.
10. **`app-layout` cannot pick `document-link` for a stand-in reference,** since `app-model` binds no
    property to a type (the moves kit's item 5, still): the policy link and its three `show`
    fields were given their widget by hand, and the form edits the link as an id.
11. **A facet takes no widget but `document-link`,** so the Adjuster facet shows user names as
    stored, `noor.halvorsen`, where the column beside it shows the person through `user`.
    Candidate: `user` on a facet.
12. **`app-model` gives each aggregate ten buckets,** with no option: an adjuster facet on a larger
    team would leave adjusters out with no word.
13. **The skill says nothing of the `external` card or connectors:** what a kit writes, where the
    contribution goes and how `--registered` holds it are only in the connectors README. Candidate:
    a bullet in the skill's step 2, and one in step 3 for `--registered`.
14. **Dev mode shows a demo kit's shell, not its pages** (the tutorial's item 8, still), and the
    preview needs a person signed in: no page of this kit was seen. **Since fixed:**
    `npm run kit:stand-in` answers the kit's model, records and page providers from its own files,
    between the dev server and the local Nuxeo, read-only, and `preview_package` gives its commands
    ([package-pipeline.md](../../../docs/business-apps/package-pipeline.md#a-demo-kits-pages-in-dev-mode)).
    Seen that way on 27 November 2026, as the local Nuxeo's guest: the home's two open-claims
    figures, the open claims queue with its four facets, PC-24003's page with its late-report
    banner and its policy, and POL-PC-1001's with its two claims. Not answered, HTTP 501, since
    `EXPECTED` does not list them: the mail capture's `pc_capture_review` and `pc_claim_mail`, so
    the "Mail to confirm" figure and queue and a claim's mail list show their error. The
    `external` card's connector is the server's, and is not shown either.
15. **Nothing in the repository connects an agent to the MCP server without registering it** in
    the person's Claude configuration (the moves kit's item 14, still): this run used a client of
    its own, outside the repository.
16. **The scaffolded README still offers a button** (`app-action`) for a package with none, though
    `package.xml` no longer describes actions (the moves kit's item 13, half fixed).
17. **What went well:** every write answered with its files and the pipeline's own lines, and each
    refusal named the file, the place and the reason and left the package as it was; the demo-kit
    order worked first time in one call of 9 changes; and several of the moves kit's items are
    fixed: `app-model --attachments` (its 1), "Left out" naming `files:files` (its 7), queue and
    related-list columns held to the model (its 8), `describe_page_provider` answering from a kit's
    own model (its 9), `preview_package` naming the Edit form (its 10), and the pipeline's NXQL
    token check (its 12). `app.rules.dateAfter` and `show` (its 2 and 3) made the late-report banner
    and the policy's values on the claim page possible with no copy on the claim.

Since 0.2.0, capture met these:

18. **`app-model` writes no type with an add-on's facet and a file of its own, and no folder with
    subtypes** (the onboarding kit's items 2 and 3, still): `PropertyClaimMail` and
    `PropertyClaimInbox` are in a component by hand.
19. **No generator or write tool writes an add-on's contribution,** here the capture profile, nor
    `package.xml`'s dependency on an add-on (the onboarding kit's item 5, still). By hand.
20. **The app cannot put a file into a kit's own file type.** Its Create form has no file input,
    and its import into a folder picks Nuxeo's own types only, `File`, `Picture`, `Video` and
    `Audio` (`resolveImportBlobDocType` in `libs/shared/nuxeo-client`): dropped into the inbox, a
    letter would be created as a `File`, which the inbox does not take. So the letters come in
    through the REST API, as a scanner's would, `demo/mail-in.mjs`. Candidate: the import taking a
    folder's one subtype with the `file` schema.
21. **The Edit form types the decision and the claim** (layout version 2's form, section 11: a
    `status-badge` is a text field, a `document-link` the stored id, until the select and the
    picker come). So an adjuster types `confirm`; correcting the claim number, which the server
    matches again, saves them typing a claim's id. Candidate: a one-click confirm, a row action on
    the queue that sets the decision.
22. **A type with a file of its own keeps its own view,** the file first (`OWN_VIEW_SCHEMAS`), so a
    piece of mail has no record page of the kit's: its capture properties are in the Properties
    panel, by their labels. That suits an adjuster checking a letter against what was read of it,
    and a record page beside the file would order them.

## Decided without the user

Each reversible, each the agent's recommendation:

- **The type names** `PropertyClaim` and `PropertyPolicy`, prefixes `pclaim` and `ppolicy`; the app
  id `pc-claims` at `property-claims`; the groups `property-claims-adjusters` and
  `property-claims-managers`.
- **The statuses and causes** above; "open" is `Reported`, `Investigating` and `Approved`.
- **The reserve threshold,** 50,000 USD, over it meaning more than, and open claims only.
- **The connector,** `pcclaims.policyPayments`, keyed on the claim number, with the stand-in's path
  and fields, in `demo/` rather than the bundle; the stand-in core system left unchanged.
- **The claim number read-only** in the Edit form.
- **The queue id `open-property-claims`,** after the clash with the moves kit's.
- **The high-reserve queue, its menu entry and its home figure for claims managers only,** and the
  rest for everyone. Hiding a queue is not a security control.
- **A Policy facet on the open claims,** shown by title, the one reference a facet could group by:
  status, cause and adjuster are not references.
- **Banners not asked for:** a denied claim, a policy not in force, a policy ending within 30 days.
- **Since 0.2.0, capture's:** the type names `PropertyClaimMail` and `PropertyClaimInbox`; the
  profile `pc-claims-mail`, its one class, its three keywords and its four fields, the claim number
  its only key; the threshold, the add-on's 85%; the queue `mail-to-confirm`, for everyone in the
  app, and its home figure; the claim page's card of filed mail; the inbox's place, `inbox` in the
  kit's workspace, created by `mail-in.mjs` rather than the seed, so the seed and its controls are
  as they were; the two letters, their senders and what each says; and the version, 0.2.0, a
  minor, though the pipeline asks a patch, since the package now needs the capture add-on.

## Not done yet

- **Installing, seeding, connecting the core system and the live pages:** a person's.
- **The core system's records** for this kit's claims (item 4).
- **The photo from a phone:** phase 8's capture app is not built; the attachments are its place.
- **The adjusters are names, not people.**
- **The Properties panel beside the record page** is version 1's generated one; a `metadata` layout
  would order it.
- **`content-model.json` is `app-model`'s,** until it is exported from a server with the package
  installed; since 0.2.0, with the capture types and the add-on's facet added by hand.
- **Capture on a server:** demo step 3 has not run. The add-on and the kit 0.2.0 are installed
  nowhere, and the inbox's permissions are an administrator's to give.
- **The AI provider:** the demo uses the stand-in. The AI package's capture operations do not exist
  yet, and the AI data terms are not approved
  ([the add-on's README](../../../nuxeo-agentic-capture/README.md#before-the-ai-provider-is-switched-on)).
- **Mail from the app,** and a one-click confirm (feedback items 20 and 21).
