# Tutorial: another system's data on a record page, kept fresh

For a presales engineer showing a record that lives partly in another system, and for the
administrator who sets it up: a claim's page in Nuxeo with its payment and policy read live from a
core claims system, kept for a time, dropped when the core system says the record changed, and the
claim's own changes sent back out. All of it is
[`nuxeo-agentic-connectors`](../../../nuxeo-agentic-connectors/README.md), version 0.2.0, with its
stand-in core system and stand-in webhook receiver, and the Payers kit's claims.

**How this was checked.** On 27 November 2026, in a checkout of `staging/enterprise-grade-app` at
`d1f315cf5`, on macOS with Node 24.22.1 and JDK 21: the add-on's Java tests, both stand-ins and their
controls, the kit-side writes on a scratch copy of the Payers kit, and the pipeline. Section 2 ran
again after the branch's merge of `3c1c4c51d`, which raised the Payers kit to 0.8.0 and changed its
claim page, and is quoted from that run. The outputs are trimmed. No Nuxeo server was read or written. Each step that needs one is
marked **Server step**, and was not run.

## What is built, and what is not

From the add-on's README, "Nothing here is installed on any server yet" and "Not done, and not
checked":

- **Installed nowhere.** The add-on is proven by its Java tests, some in the Nuxeo test framework's
  runtime and repository, against stubs on the loopback interface. Nothing was checked on a
  2025.10.18 server.
- **No Marketplace package.** The add-on is a bundle: its jar goes into `nxserver/bundles/`, and a
  kit's connector contribution goes beside its package, not in it, since a kit cannot depend on a
  package that does not exist.
- **One node only.** A change event drops the answers kept on the node it reaches; the other nodes'
  live out their time to live. Dropping them on every node is not built.
- **Webhooks never go through a proxy,** keep one receiver and one secret each, and do not order
  deliveries.
- **The stand-in core system knows the Payers kit's claim numbers only.** The P&C claims kit's
  connector, `pcclaims.policyPayments`, would find nothing there (its README, "The core system's
  card").

## 1. The add-on's own tests

```bash
mvn -B -pl nuxeo-agentic-connectors -am verify
```

```text
[INFO] Tests run: 159, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

Among them `CacheRuntimeTest` (7), the cache held to the reader's permission in a real repository;
`ChangeEventsTest` (12) and `ChangeEventRuntimeTest` (8), the signed change events; and
`WebhookReceiverInteropTest`, which runs the stand-in receiver with Node, and is skipped where Node
is not on the path. The stand-ins' own controls:

```bash
node nuxeo-agentic-connectors/demo/core-system.selftest.mjs
node nuxeo-agentic-connectors/demo/webhook-receiver.selftest.mjs
```

```text
16 of 16 passed
15 of 15 passed
```

## 2. The connector, from the kit's side

A kit contributes a connector: which property holds the key, the path on the other system, and the
fields that may come back. Never the address or the credential: each server sets those. The add-on's
README, "How a kit opts in", describes the Payers kit's opt-in and says it is "not done here". This
section does it on a scratch copy of the kit, through the write tools, and leaves the kit alone.

```bash
mkdir -p /tmp/payers-kits /tmp/connectors-demo
cp -R business-apps/packages/payers-claims-demo /tmp/payers-kits/
```

The write tools' arguments: `app-connector` with the demo connector's fields, the add-on's demo card,
`demo/Claim.view.layout.json`'s `payment` card, added to the claim page with a label key, and the
key's text. With `bankAccount` given, the card also asks for a field the connector does not return:

```bash
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const kit = '/tmp/payers-kits/payers-claims-demo', cfg = 'bundle/agentic-ui-config';
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const layout = read(kit + '/' + cfg + '/layouts/Claim/view.layout.json');
const { label, ...card } = read('nuxeo-agentic-connectors/demo/Claim.view.layout.json').cards.find((each) => each.external);
card.labelKey = 'payers.card.claim.payment';
if (process.argv[1] === 'bankAccount') card.external.fields.push({ name: 'bankAccount', label: 'Bank account' });
layout.cards.push(card);
const labels = read(kit + '/' + cfg + '/labels/en.json');
labels.labels['payers.card.claim.payment'] = label;
writeFileSync('/tmp/connectors-demo/opt-in-' + process.argv[1] + '.json', JSON.stringify({ package: kit, changes: [
  { kind: 'generator', generator: 'app-connector', options: { id: 'payers.claimPayments', type: 'Claim',
    key: 'claim:number', path: '/claims/{key}',
    fields: 'paymentStatus=/payment/status,paidAmount=/payment/amount,paidOn=/payment/paidOn,paymentReference=/payment/reference,policyNumber=/policy/number,policyStatus=/policy/status,deductibleMet=/policy/deductibleMet' } },
  { kind: 'write', path: cfg + '/labels/en.json', content: JSON.stringify(labels, null, 2) + '\n' },
  { kind: 'write', path: cfg + '/layouts/Claim/view.layout.json', content: JSON.stringify(layout, null, 2) + '\n' },
] }));
" bankAccount
```

Run it again with `good` in place of `bankAccount`, for the card as the demo has it. Then the one
with `bankAccount` first, which must be refused:

```bash
env -u SATORI_GH_READONLY_TOKEN -u NUXEO_USER -u NUXEO_PASS BUILDER_PACKAGE_ROOTS=/tmp/payers-kits \
  node tools/builder-mcp/src/call.ts apply_package_changes - < /tmp/connectors-demo/opt-in-bankAccount.json > /tmp/connectors-demo/answer.json
node -e "const a = require('/tmp/connectors-demo/answer.json'); console.log(a.written, a.validation.findings.map((f) => f.place + ': ' + f.message))"
```

```text
false [
  'cards[3].external.fields[7].name: the connector "payers.claimPayments" (connectors/payers-claims-demo-connectors-config.xml) does not return the field "bankAccount": it returns paymentStatus, paidAmount, paidOn, paymentReference, policyNumber, policyStatus, deductibleMet'
]
```

The stand-in's record does hold a bank account, and an adjuster's note: neither is on the connector's
allow-list, so neither reaches the page. Then the card as the demo has it:

```bash
env -u SATORI_GH_READONLY_TOKEN -u NUXEO_USER -u NUXEO_PASS BUILDER_PACKAGE_ROOTS=/tmp/payers-kits \
  node tools/builder-mcp/src/call.ts apply_package_changes - < /tmp/connectors-demo/opt-in-good.json > /tmp/connectors-demo/answer.json
node -e "const a = require('/tmp/connectors-demo/answer.json'); console.log(a.written, a.changes); console.log(a.generatorOutput[0])"
```

```text
true [
  {
    path: 'bundle/agentic-ui-config/labels/en.json',
    change: 'updated'
  },
  {
    path: 'bundle/agentic-ui-config/layouts/Claim/view.layout.json',
    change: 'updated'
  },
  {
    path: 'connectors/payers-claims-demo-connectors-config.xml',
    change: 'created'
  }
]

Wrote the connector payers.claimPayments to business-apps/packages/payers-claims-demo/connectors/payers-claims-demo-connectors-config.xml:

  Reads:        Claim, by claim:number, at /claims/{key}
  Returns:      paymentStatus, paidAmount, paidOn, paymentReference, policyNumber, policyStatus, deductibleMet
  Address:      the server property nuxeo.agentic.connectors.payers.claimPayments.address
  Credential:   Authorization: Bearer <token>, from nuxeo.agentic.connectors.payers.claimPayments.token or NUXEO_CONNECTOR_PAYERS_CLAIMPAYMENTS_TOKEN
  Held to:      the content model, its types and key
```

- **The contribution is beside the bundle,** in `connectors/`, not in it, as the skill says: carried
  by the bundle, it would stay pending on every server without the add-on. It is the add-on's demo
  connector, `demo/payers-claim-payments-config.xml`, but for the limits it leaves at the add-on's
  defaults.
- **The pipeline holds the card to it.** The copy builds, given its deployment's allow-list, as CI
  gives it:

  ```bash
  npm run app-package -- /tmp/payers-kits/payers-claims-demo --platform 0.2.0 \
    --allow-list /tmp/payers-kits/payers-claims-demo/deployment/build-allow-list.json
  ```

  ```text
  4 layouts were held to the content model in /tmp/payers-kits/payers-claims-demo/content-model.json.
  17 files: 16 passed, 0 refused, 1 in version 1, which this does not check.
  payers-claims-demo 0.8.0: checked, built and verified: …
  ```

  A real change to the kit would also raise its version: the pipeline's `--previous` refuses a
  change at the same version (package-pipeline.md, section 8).

- **A card on a connector the server registers, not the kit,** is held to it only when the pipeline
  is given what the server registers, `--registered`. The P&C claims kit does this, with its own
  `demo/registered.json`:

  ```bash
  npm run app-package -- business-apps/packages/pc-claims-demo --platform 0.2.0 \
    --registered business-apps/packages/pc-claims-demo/demo/registered.json
  ```

  It passed: `11 files: 11 passed, 0 refused`. Given the add-on's `registered.json` instead, which
  has the Payers connector only, it exits 1:
  `cards[3].external.connector: the connector "pcclaims.policyPayments" is not registered [unknown]`.

## 3. The stand-in core system

Make up a token, a webhook secret and, for the server steps, a connector events secret, for the
demo, in files only you can read. Never reuse a real
one, and never write one into a command line, a file in the repository or a URL:

```bash
umask 077
openssl rand -hex 16 > /tmp/connectors-demo/core-token
openssl rand -hex 32 > /tmp/connectors-demo/webhook-secret
openssl rand -hex 32 > /tmp/connectors-demo/events-secret
```

Start the stand-in, in a terminal of its own. It answers on 127.0.0.1:8091, and requires the token
on every request:

```bash
CORE_SYSTEM_TOKEN=$(cat /tmp/connectors-demo/core-token) node nuxeo-agentic-connectors/demo/core-system.mjs
```

```text
The stand-in core system answers on http://127.0.0.1:8091/claims/<number>
```

Ask it as the connector would, with the token in the header the contribution names:

```bash
for n in CLAIM-000130 CLAIM-000144 CLAIM-000999; do
  curl -s -w '\nHTTP %{http_code}\n' -H "Authorization: Bearer $(cat /tmp/connectors-demo/core-token)" http://127.0.0.1:8091/claims/$n
done
curl -s -w '\nHTTP %{http_code}\n' http://127.0.0.1:8091/claims/CLAIM-000130
```

```text
{"claimNumber":"CLAIM-000130","payment":{"status":"Paid","amount":412.5,"paidOn":"2026-10-02","reference":"EFT-FICT-55120"},"policy":{"number":"POL-FICT-0048","status":"In force","deductibleMet":true},"adjusterNotes":"Internal note, not on the allow-list: the record page never shows it.","bankAccount":{…}}
HTTP 200
{"error":"the core system is down for this demo"}
HTTP 503
{"error":"no such claim"}
HTTP 404
{"error":"unauthorised"}
HTTP 401
```

`CLAIM-000143` answers after 8 seconds, past the connector's 5-second timeout. The stand-in logs each
request's method, path and status, never its token. Stop it with Ctrl+C.

**What the card shows of each,** on a server (the add-on's README, "The demo: a claim with live
core-system data"): for `CLAIM-000130`, Paid, $412.50, the date, the reference, the policy and its
status, and never the adjuster's note or the bank account; for `CLAIM-000144`, the error with Retry;
for `CLAIM-000143`, the error after the timeout; for a number the stand-in does not know, "Nothing
found in the other system".

## 4. On the server: the connector, its cache and its change events

**Server step, all of it.** The add-on's README, "Installing it on the local Docker Nuxeo, for the
demo", has the commands; none was run here, and each changes the server.

1. **The bundle and the contribution:** the jar into `nxserver/bundles/`, and the connector's
   contribution into `nxserver/config/`.
2. **The server's settings,** in `nuxeo.conf`, each the connector's id under
   `nuxeo.agentic.connectors.`:

   | Setting                                | For the demo                                                         |
   | -------------------------------------- | -------------------------------------------------------------------- |
   | `….payers.claimPayments.address`       | The stand-in's, `http://host.docker.internal:8091` from Docker       |
   | `….payers.claimPayments.http.allowed`  | `true`, since the stand-in is plain `http`. A demo server only       |
   | `….payers.claimPayments.token`         | The token you made up, through standard input, never a command line  |
   | `….payers.claimPayments.cache.ttl`     | `300`: answers kept 5 minutes. Unset, nothing is kept                |
   | `….payers.claimPayments.events.secret` | The events secret, at least 32 characters. Unset, events are refused |

   On a container that has started before, write them into `/etc/nuxeo/nuxeo.conf` itself: a file
   added to `conf.d` later is never read ([administrator-guide.md](../administrator-guide.md),
   section 3).

3. **The Payers kit installed and seeded,** so that claims with the stand-in's numbers exist. Since
   0.8.0 the kit needs `nuxeo-agentic-letters`, which needs Nuxeo's Template Rendering
   ([administrator-guide.md](../administrator-guide.md), section 3).
4. **The page:** `npm run config:dev -- --layout Claim/view=nuxeo-agentic-connectors/demo/Claim.view.layout.json`,
   then `npx nx serve nuxeo-ui`, signed in as a Payers demo user. Open `CLAIM-000130`.
5. **The cache:** open it again within 5 minutes. The card says "Read from the other system" and how
   long ago, and the stand-in logs no new request. A reader who may not read the claim is refused
   before the cache is looked at, kept answer or not. A refresh past the cache, `"refresh": true`,
   is an administrator's only.
6. **A change event:** the core system says the record changed, signed with the events secret, and
   the kept answers for that key are dropped. The stand-in sends one:

   ```bash
   CORE_SYSTEM_EVENTS_SECRET=$(cat /tmp/connectors-demo/events-secret) node nuxeo-agentic-connectors/demo/core-system.mjs \
     notify CLAIM-000130 --to http://localhost:8080/nuxeo/agentic-connectors/events/payers.claimPayments
   ```

   The server's `….payers.claimPayments.events.secret` is the same secret, from the same file. It
   prints `204`, and the next card asks the stand-in again: "just now". With a wrong secret,
   `401`, and the kept answer stays. An event does nothing else: it opens no session, reads no
   document and writes nothing.

## 5. Outbound webhooks: the receiver's side, offline

A webhook sends a document's changes to another system: the events, the types and the properties
the contribution names, after the transaction commits, signed with a secret each server sets. The
demo's is `demo/payers-claim-webhook-config.xml`, `payers.claimUpdates`: a Claim's number, title and
lifecycle state, on created, modified, transitioned and a workflow task done.

Start the stand-in receiver, in a terminal of its own:

```bash
WEBHOOK_SECRET=$(cat /tmp/connectors-demo/webhook-secret) node nuxeo-agentic-connectors/demo/webhook-receiver.mjs
```

```text
The stand-in receiver takes webhook payers.claimUpdates on http://127.0.0.1:8092/nuxeo-webhooks
```

Sign a delivery by hand, as the add-on signs one, with the scheme the README gives under "How a
receiver checks a delivery": the HMAC-SHA256 of the webhook's id, the timestamp and the nonce, each
followed by a line feed, then the body. The document's id here is made up:

```bash
WEBHOOK=payers.claimUpdates
DELIVERY=$(openssl rand -hex 16)
send() {
  TIMESTAMP=$(date +%s); NONCE=$(openssl rand -hex 16)
  BODY='{"delivery":"'"$DELIVERY"'","event":"modified","document":{"id":"00000000-0000-4000-8000-000000000130","type":"Claim"},"fields":{"claimNumber":"CLAIM-000130","title":"A fictional claim","state":"approved"}}'
  SIGNATURE=$(printf '%s\n%s\n%s\n%s' "$WEBHOOK" "$TIMESTAMP" "$NONCE" "$BODY" | openssl dgst -sha256 -hmac "$1" -r | cut -d' ' -f1)
  curl -s -o /dev/null -w 'HTTP %{http_code}\n' -X POST http://127.0.0.1:8092/nuxeo-webhooks \
    -H 'Content-Type: application/json' -H "X-Nuxeo-Webhook: $WEBHOOK" \
    -H "X-Nuxeo-Connector-Timestamp: $TIMESTAMP" -H "X-Nuxeo-Connector-Nonce: $NONCE" \
    -H "X-Nuxeo-Connector-Signature: sha256=$SIGNATURE" --data-binary "$BODY"
}
send "$(cat /tmp/connectors-demo/webhook-secret)"
send "$(cat /tmp/connectors-demo/webhook-secret)"
send "$(openssl rand -hex 32)"
```

```text
HTTP 204
HTTP 204
HTTP 401
```

The receiver's log says why each was answered so:

```text
POST /nuxeo-webhooks 204 accepted <delivery> modified of a Claim 00000000-0000-4000-8000-000000000130 [claimNumber,title,state]
POST /nuxeo-webhooks 204 duplicate <delivery>
POST /nuxeo-webhooks 401 bad-signature
```

The second is the same delivery again, a retry or a resend, answered 2xx and not taken twice. The
third was signed with another secret. The log names the fields, never their values. Stop the
receiver with Ctrl+C.

## 6. On the server: deliveries, retries and dead letters

**Server step, all of it,** from the add-on's README, "The demo: a claim's changes sent to another
system". None was run.

1. **The webhook's contribution** into `nxserver/config/`, and its settings in `nuxeo.conf`, under
   `nuxeo.agentic.webhooks.payers.claimUpdates.`: the `address`, the receiver's on the Docker host;
   `private.allowed` and, for plain http, `http.allowed`, a demo server only; and the `secret`, at
   least 32 characters, through standard input. Without the address or the secret, the webhook sends
   nothing and keeps nothing.
2. **Change a claim:** the receiver logs `204 accepted`, the event and the three fields' names.
3. **Retries, then a dead letter:** restart the receiver with `--answer 503`. Each attempt is retried,
   30 seconds, then 2 and 8 minutes apart, up to `maxAttempts`, then kept as a dead letter for 30
   days. `<maxAttempts>2</maxAttempts>` in the demo's webhook shows one sooner.
4. **An administrator lists and resends,** with `Webhook.Deliveries`, `{"params":{"state":"dead"}}`,
   and `Webhook.Resend`, `{"params":{"delivery":"<its id>"}}`. Anyone else is refused, 403. A list
   never holds a payload.
5. **The audit,** category `agenticWebhooks`: an entry per attempt, naming the delivery and the
   outcome, never a field's value, the address or the secret.

## Cleaning up

Remove `/tmp/payers-kits` and `/tmp/connectors-demo`: the second holds the made-up token and
secret. On a server, remove the contributions and delete the settings' lines from `nuxeo.conf`, as
the add-on's README says.
