# Tutorial: holds, retention and related records on a record page

For a presales engineer showing a legal hold, and for the administrator who sets one up: a record
page that shows the record's retention and its legal holds, offers Place and Release legal hold
with a reason, and says why the server refuses a deletion while the hold is on; and a related list
that lists a record's related records and creates a new one from the page. The worked example is the
onboarding kit, [`onboarding-demo`](../../../business-apps/packages/onboarding-demo/README.md) 0.2.0:
a dispute's page with its Legal hold card, and an onboarding case's page with its Disputes card. The
server side is the platform's retention module, `nuxeo-retention`, and
[`nuxeo-agentic-records`](../../../nuxeo-agentic-records/README.md) 0.4.0.

**How this was checked.** On 27 November 2026, in a checkout of `staging/enterprise-grade-app` at
`d1f315cf5`, on macOS with Node 24.22.1 and JDK 21: the records add-on's Java tests, the client's
specs for the two cards, the kit's pipeline build and its seed's controls, and three breaks of the
kit on a scratch copy. The outputs quoted are that run's, trimmed. The build, the controls and the specs ran again after the branch's merge of `3c1c4c51d`, which added the letters add-on, with the same outputs. No Nuxeo server was read or
written. Each step that needs one is marked **Server step**, and was not run.

## What is built, and what is not

From the kit's and the add-on's READMEs:

- **Installed nowhere.** No server has the kit, the records add-on or the retention module. The
  hold's demo, phase 7's step 5, "A legal hold blocks a deletion, on the server", is held by the
  add-on's tests in Nuxeo's 11.5 test framework, and its steps file has not run.
- **The retention module is Nuxeo's own Marketplace package,** published for LTS 2025, which the
  local 2025.10.18 server does not have. Its newest builds need LTS 2025.18 or later.
- **One hold per record:** the platform's hold is one flag, and its history is the audit's. A hold
  on every record of a folder at once, and a hold that keeps a record's other properties, are not
  built: a held record's description stays editable, as the platform keeps it.
- **The buttons are decision 3's operation buttons,** through the deployment's allow-list. Hiding a
  button is not the control: the server's permissions and the hold are.

## 1. What the record page says

The dispute's page, `layouts/DisputeCase/view.layout.json`, has a card of the kind
[layout-v2.md](../layout-v2.md) calls "Retention and legal holds", section 7:

```json
{
  "id": "holds",
  "labelKey": "onboarding.card.disputeCase.holds",
  "span": 2,
  "holds": {
    "place": "onboarding.dispute.placeHold",
    "release": "onboarding.dispute.releaseHold",
    "pageSize": 5
  }
}
```

- **Everything it shows is the platform's:** the retention and the hold from the document's JSON,
  `retainUntil`, `isRecord` and `hasLegalHold`; the rule, the first of the retention module's
  `record:ruleIds`, by its title; and the holds placed and released, newest first, from the audit's
  `afterSetLegalHold` and `afterRemoveLegalHold`, each with who, when and the reason, the audit's
  comment.
- **`place` and `release`** name actions of the package's own `actions.json`, shown `"on": ["card"]`.
  The kit's run the retention module's `Document.Hold`, whose `description` is the reason, and the
  records add-on's `Records.ReleaseLegalHold`, since the module's `Document.Unhold` takes no reason.
  Each asks for the reason in a form, and is enabled for `dispute-analysts`.
- **Offered** only on a live record, on a page that is not read-only, to someone who holds the
  platform's `ManageLegalHold` there, and only where the app registry served the action, which it
  does only if the server's allow-list lets it run.

The case's page, `layouts/OnboardingCase/view.layout.json`, lists the case's disputes, and creates
one from the page, with `create` on its related list:

```json
"create": {
  "type": "DisputeCase",
  "field": "dsp:case",
  "labelKey": "onboarding.action.newDispute",
  "in": { "pageProvider": "onboarding_dispute_registers" }
}
```

New dispute opens the dispute's Create form with `dsp:case`, the case's id, filled in and read-only,
and files the dispute in the register the page provider finds, under the person's own permission to
create there. A person who may not add to the register is offered no New, and the server refuses a
create sent past the page.

## 2. The client's specs for the two cards

```bash
npx vitest run --config libs/shared/document-layouts/vite.config.mts record-holds record-create
```

```text
 ✓ |document-layouts| src/lib/record-page/record-holds.spec.ts (14 tests)
 ✓ |document-layouts| src/lib/record-page/record-create.spec.ts (10 tests)
 Test Files  2 passed (2)
      Tests  24 passed (24)
```

## 3. The kit, built, and what the pipeline refuses

The kit's actions run operations, so the pipeline needs the deployment's allow-list, as CI gives it:

```bash
npm run app-package -- business-apps/packages/onboarding-demo --platform 0.2.0 \
  --model business-apps/packages/onboarding-demo/content-model.json \
  --allow-list business-apps/packages/onboarding-demo/deployment/build-allow-list.json
```

```text
8 layouts were held to the content model in business-apps/packages/onboarding-demo/content-model.json.
16 files: 16 passed, 0 refused.
Compared with the 10 other kits in business-apps/packages: no name of the package's is another's.
onboarding-demo 0.2.0: checked, built and verified: business-apps/packages/onboarding-demo/dist/onboarding-demo-0.2.0.zip, sha256 8946307a…80da5
```

The allow-list, `deployment/build-allow-list.json`, names `Document.Hold` and
`Records.ReleaseLegalHold`. It is the deployment's, never the package's: the server's own is
`deployment/onboarding-demo-operations-config.xml`, which an administrator puts in
`nxserver/config/`. Three breaks, on a scratch copy, so the kit is left alone:

```bash
mkdir -p /tmp/holds-kits
cp -R business-apps/packages/onboarding-demo /tmp/holds-kits/
K=/tmp/holds-kits/onboarding-demo
```

**No allow-list:** every operation is refused.

```bash
npm run app-package -- $K --platform 0.2.0
```

```text
…/actions.json: actions[0].operation: the operation "Document.Hold" is not on this deployment's allow-list [unknown]
…/actions.json: actions[1].operation: the operation "Records.ReleaseLegalHold" is not on this deployment's allow-list [unknown]
No --allow-list was given, so every operation is refused.
/tmp/holds-kits/onboarding-demo: step 2 refused it: the app definition has findings, listed above.
```

**The holds card naming an action the package does not have:**

```bash
sed -i.bak 's/"place": "onboarding.dispute.placeHold"/"place": "onboarding.dispute.placeHld"/' \
  $K/bundle/agentic-ui-config/layouts/DisputeCase/view.layout.json
npm run app-package -- $K --platform 0.2.0 --allow-list $K/deployment/build-allow-list.json
mv $K/bundle/agentic-ui-config/layouts/DisputeCase/view.layout.json.bak $K/bundle/agentic-ui-config/layouts/DisputeCase/view.layout.json
```

```text
…/layouts/DisputeCase/view.layout.json: cards[2].holds.place: the action "onboarding.dispute.placeHld" is not one of the package's actions.json that shows on a card ("on": ["card"]) [unknown]
```

**New dispute filling a property the dispute does not have:**

```bash
sed -i.bak 's/"field": "dsp:case",/"field": "dsp:cas",/' $K/bundle/agentic-ui-config/layouts/OnboardingCase/view.layout.json
npm run app-package -- $K --platform 0.2.0 --allow-list $K/deployment/build-allow-list.json
mv $K/bundle/agentic-ui-config/layouts/OnboardingCase/view.layout.json.bak $K/bundle/agentic-ui-config/layouts/OnboardingCase/view.layout.json
```

```text
…/layouts/OnboardingCase/view.layout.json: cards[5].related.create.field: "dsp:cas" is not a property of the type "DisputeCase" or of its facets [unknown]
```

Each exits 1. Put back, the copy builds the kit's own zip again, `8946307a…80da5`.

## 4. What the server refuses while a hold is on

The add-on's tests, in Nuxeo's test framework, with a real repository and the platform's retention,
hold, security and transactions, and the retention module's model read from its jar:

```bash
mvn -B -pl nuxeo-agentic-records -am verify
```

```text
[INFO] Tests run: 154, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

`LegalHoldGuardTest` (11) and `ReleaseLegalHoldTest` (4) are the hold's. What they hold, from the
add-on's README, "Legal holds: what the add-on adds to the platform's":

| A held record                                              | Refused by                                                                                                 | With                                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Deleted or put in the trash, by a person                   | The platform first: it takes `Remove` from the record                                                      | 403, the platform's message                                                                                    |
| Deleted or put in the trash, by an administrator           | The add-on, first; the platform lets the trash through, and its repository would still refuse the deletion | 409, "This record is under a legal hold: it cannot be put in the trash or deleted until the hold is released." |
| A folder holding it, deleted or put in the trash           | The add-on, for everyone                                                                                   | 409, its own sentence                                                                                          |
| Its files changed, its attachments included                | The add-on, for everyone, through a live proxy too                                                         | 409, "This record is under a legal hold: its files cannot be changed until the hold is released."              |
| Its title, status or description edited                    | Nobody: a hold keeps the record and its files                                                              | Saved                                                                                                          |
| Released with an empty reason, or one over 1000 characters | `Records.ReleaseLegalHold`                                                                                 | 400, `reason`; with no reason at all, Automation refuses the run                                               |
| Released while under no hold                               | `Records.ReleaseLegalHold`                                                                                 | 409, `not-held`                                                                                                |
| Released by someone without `ManageLegalHold`              | The platform, as the operation runs as the person                                                          | 403, the hold still on                                                                                         |

The record page shows the server's sentence when it refuses a deletion or a change of the files.

## 5. The seed

```bash
node business-apps/packages/onboarding-demo/demo/seed.selftest.mjs
```

```text
21 of 21 passed
```

The controls run the seed against a stand-in for the REST API: they prove the script, not a server.
The seed writes four onboarding cases and three disputes, `DSP-2002` raised on `ONB-1001`, and gives
`dispute-analysts` the platform's `ManageLegalHold` on the disputes register and `Read` on the
onboarding register. It creates no user and no group, places no hold, and stops, exit 2, before
writing anything, when the retention module, the records add-on or the e-signature add-on is missing.

## 6. On a server

**Server step, all of it.** None was run.

1. **Install,** after review (the kit's README, "Installing it on a local Nuxeo"):
   `nuxeo-agentic-signature` 0.1.0, the retention module from the Marketplace, `nuxeo-agentic-records`
   0.4.0, then the kit, with `nuxeoctl mp-install --accept=true`; put
   `deployment/onboarding-demo-operations-config.xml` in `nxserver/config/`; restart. Check that the
   server log's `Component Loading Status` has nothing pending or missing.
2. **The groups and people:** `onboarding-officers`, `kyc-analysts` and `dispute-analysts`, in the
   server's directory.
3. **The seed,** as an administrator: `node business-apps/packages/onboarding-demo/demo/seed.mjs`.
4. **A dispute analyst opens `DSP-2002`:** not under retention, no legal hold, and Place legal hold.
   Placed, with a reason, the dispute is made a record and held, and the card lists the hold with who,
   when and why. Delete is no longer offered; a deletion or a trash sent anyway is refused, 403;
   removing an attachment is refused, 409, and the page says the add-on's sentence. Editing the
   status still saves. Release legal hold, with a reason, lists the release under the hold.
5. **The analyst opens `ONB-1001`:** its Disputes card lists `DSP-2002`, and New dispute files a new
   one in the disputes register, the case filled in. An onboarding officer is offered no New.
6. **The steps file,** which does steps 4 and 5 and checks each, as a dispute analyst who is not an
   administrator, with an onboarding officer's account named in the environment:

   ```bash
   NUXEO_USER=<analyst> NUXEO_PASS=<password> ONBOARDING_OFFICER=<officer> \
     ONBOARDING_OFFICER_PASSWORD=<password> npm run beta:evidence -- onboarding-holds
   ```

   It refuses to run, exit 2, without the kit installed, seeded and served, and the two people. An
   administrator's trash, which the add-on refuses with its own 409, is the Java tests', not this
   file's.

## Cleaning up

Remove `/tmp/holds-kits`. Nothing else was written outside the kit's `dist/` and Maven's `target/`,
which git ignores.
