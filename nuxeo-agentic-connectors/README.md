# Nuxeo Agentic Connectors

Records that live elsewhere: live data from a system of record on a record page. The first two
slices of phase 7 of the business apps [development plan](../docs/business-apps/development-plan.md):
the live data, then its caching and the system of record's change events. Built on the
recommendation of decision D, "inside Nuxeo as an add-on; a separate service only when one needs
it" ([decision log](../docs/business-apps/decisions.md)). The decision is still open, and the log's
note says what changes if it goes another way.

**Version 0.1.0.** The bundle's version, `Bundle-Version` in its manifest and `connectors.version`
in its pom; 0.0.1 was the first slice. The jar is still named by the Maven build's version,
`2026.0.2-SNAPSHOT`.

**Nothing here is installed on any server yet.** It is proven by its Java tests, some in the Nuxeo
test framework's runtime and repository, against a stub of the other system on the loopback
interface, by the client's tests and by the validator. The install and the demo below are for the
reviewer.

## The short version

- **A kit contributes a connector**, a server component: which document property holds the key,
  the path on the other system, the fields that may come back, and the names of the server
  settings that hold the address and the credential.
- **Each server sets the address and the credential**, in `nuxeo.conf` (the credential also from
  the environment). Neither is ever in a contribution, a document, a layout or a request.
- **`Connector.Read`**, an Automation operation, reads one record for a document: it checks the
  reader's permission on the document, reads the key, calls the other system once within the
  connector's bounds, and returns only the allowed fields, as JSON.
- **Its answers may be kept,** per connector, document and key, for a time each server sets per
  connector, and never by a client. Every check runs again before a kept answer is given, so it
  reaches no one who could not have had it from the system ([The cache](#the-cache)).
- **A system of record says when a record changes,** with a signed event to
  `/nuxeo/agentic-connectors/events/<connector>`, and the answers kept for it are dropped. The
  event is signed with a secret each server sets per connector, and is refused when its timestamp
  is old or its nonce seen; it does nothing else ([Change events](#change-events)).
- **Layout version 2's `external` card** shows the answer on the record page, with loading, empty
  and error states, and how old the answer is ([layout-v2.md](../docs/business-apps/layout-v2.md),
  section 7). The validator checks it: no address anywhere in the card, field names that are
  names, the widgets that show one value as text, and, given the server's connectors, each field
  against its connector's allow-list.
- **Nothing is sent out of Nuxeo but the reads:** outbound webhooks are not built, and not in this
  slice's scope ([Outbound webhooks](#outbound-webhooks-not-built)).

## What is in it

| File                                                            | What it is                                                                                                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/java/org/nuxeo/agentic/connectors/`                   | The bundle: the descriptor, its checks (`Connector.of`), the component and service, the HTTP call, the operation, the cache, the change events and their servlet, the metrics     |
| `src/main/resources/OSGI-INF/connectors-service.xml`            | The component `org.nuxeo.agentic.connectors`, its service and its `connectors` extension point                                                                                    |
| `src/main/resources/OSGI-INF/connectors-operations-contrib.xml` | Registers `Connector.Read`                                                                                                                                                        |
| `src/main/resources/OSGI-INF/deployment-fragment.xml`           | Maps the change events' servlet on `/agentic-connectors/events/*`, with no authentication filter                                                                                  |
| `src/test/java/`                                                | 109 tests, with an embedded HTTP stub (`SystemOfRecordStub`); 16 of them in the Nuxeo test framework's runtime and repository, the change events sent over HTTP (`ServletBridge`) |
| `demo/core-system.mjs`                                          | The stand-in core claims system: fictional payment and policy records for the Payers seed's claims, and `notify`, which sends a signed change event                               |
| `demo/change-event.mjs`                                         | How the stand-in signs a change event                                                                                                                                             |
| `demo/core-system.selftest.mjs`                                 | Its controls, 16 of them                                                                                                                                                          |
| `demo/payers-claim-payments-config.xml`                         | The demo's connector, `payers.claimPayments`, keyed on `claim:number`                                                                                                             |
| `demo/Claim.view.layout.json`                                   | A Claim record page with the `external` card, for the development server                                                                                                          |
| `demo/registered.json`                                          | The connector's fields, as the validator and the package pipeline are given them with `--registered`                                                                              |

## How a call goes

```
POST /nuxeo/api/v1/automation/Connector.Read
{ "input": "doc:<the claim's id>", "params": { "connector": "payers.claimPayments" }, "context": {} }
```

1. **The reader's `Read`:** `session.hasPermission(document, "Read")`, first, so that no one learns
   which connectors exist from a record they may not read. Without it, `DocumentSecurityException`
   (403), and nothing is sent.
2. **The connector:** an id that is not a registered connector's is 404.
3. **Its own permission,** if it asks for more than `Read`: 403 without it.
4. **A read past the cache,** `"refresh": true` in the params, is an administrator's only: anyone
   else's is 403, and nothing is sent.
5. **The stored document:** `session.getDocument(ref)`. The key is read from it, never from the
   document the request gave: Automation builds an input document from a JSON entity and applies
   the entity's properties to it in memory, so a reader could otherwise send any key.
6. **Its type** must be one of the connector's `<type>`s; another answers `no-key`, and nothing is
   sent.
7. **The key:** the `<key xpath>` property, a text or a whole number, trimmed. It is sent only when
   it is one path segment of letters, digits, `.`, `_` or `-`, starting with a letter or a digit.
   Anything else, or none, answers `no-key`, and nothing is sent.
8. **The cache,** only now, and only where the server sets the connector's time to live: the
   answer kept for this connector, this stored document and this key, if it is younger than that
   time, is the answer, and nothing is sent ([The cache](#the-cache)). Otherwise, on:
9. **The address:** the server property `<address property>` names: `https` with a host and no
   user, query or fragment; plain `http` only where the server sets
   `nuxeo.agentic.connectors.<id>.http.allowed=true` for this connector. Missing or unusable: 503,
   and nothing is sent. A host name Java's `URI` does not read, such as a Docker Compose service
   with an `_`, is unusable.
10. **The credential**, if the connector has one: the server property it names, else the environment
    variable. Missing, or holding a character a header may not carry: 503, and nothing is sent.
11. **At most `maxConcurrent` calls** of the connector at once: one past it is refused at once, 503,
    rather than queued, so that a slow system holds no more of the server's request threads.
12. **One `GET`** to the address plus the path, `{key}` replaced, over HTTP/1.1, with
    `Accept: application/json` and the credential's header. **No redirect is followed.**
13. **Bounds:** a connect timeout, and one deadline for the whole call, headers and body; a body over
    `maxBytes`, by its `Content-Length` or as it arrives, is refused, and the rest is not read. The
    body of any other answer than a 200 with a JSON type is cancelled unread.
14. **The answer:** a 200 with one JSON object is `found`, and only the connector's fields are read
    from it, each at its JSON pointer, each kept only when it is a text, a number or a boolean. A
    404 is `not-found`. A redirect, any other status, another content type, or anything that is
    not one JSON object is 502; a timeout is 504. A `found` or `not-found` is kept, where the
    server keeps the connector's answers; a failure never is.

```json
{
  "connector": "payers.claimPayments",
  "status": "found",
  "age": 0,
  "fields": { "paymentStatus": "Paid", "paidAmount": 412.5 }
}
```

`age` is how long ago, in whole seconds, the other system gave the answer: 0 when it was just asked,
more when it comes from the cache. A `no-key` answer, which asked nothing, has none.

A failure's message is one neutral sentence per kind (`ConnectorException`): never the address, the
key, the credential or what the other system said. The log names the connector, the kind and the
class of the cause, and never the key, which may be personal data.

## The cache

Off unless a server turns it on, connector by connector, in `nuxeo.conf`:

| Server property                                  | Default    | What it does                                                                                                         |
| ------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `nuxeo.agentic.connectors.<id>.cache.ttl`        | Unset: off | How long an answer is kept, in whole seconds, 1 to 86400. Anything else is off, and the log says so once             |
| `nuxeo.agentic.connectors.<id>.cache.maxEntries` | 1000       | The most answers kept for the connector, 1 to 100000; the first kept are dropped first. Anything else is the default |

**Never set by a client or a kit.** No request, layout or contribution names a time to live, and
these two names are two segments under the connector's prefix, which no contribution may name
(an id may not end in `.http`, `.cache` or `.events`, so that `payers.cache` cannot name `payers`'s
settings as its own). The time is read on every lookup, so a shorter one applies to what is already
kept.

**What an answer is kept under: the connector, the document and the key.** The connector is the one
registered, compared whole, fields and pointers included; the document is the stored one's id; the
key is the one read from it as stored. So a kept answer is never given for another document, even
one with the same key, nor for the same document once its key has changed, nor once the connector
has been contributed again with other fields. A contribution that replaces or removes a connector
drops its answers too.

**How the cache respects permissions.** The reader is not in the key. Instead, the cache is asked
last, after every check a call goes through: the reader's `Read` on that very document, the
connector's own permission, and for a refresh, an administrator. A reader who may not read the
document is refused before the cache is looked at, exactly as before there was one, and a
permission taken away applies at once to what is kept. A kept answer is given to a second reader
only when that reader may read the same document, and the system would have given them the same
answer: the connector calls it with one service credential whoever reads (decision F is what would
change that, and the reader would then join the key). `CacheRuntimeTest` holds it, in a real
repository: Alice's kept answer for her claim is refused to Bob, who may not read it, and the hit
counter shows the cache was not reached; Bob's own claim's answer is his; a revoked reader is
refused what is still kept; and a document of Bob's with Alice's claim number has an answer of its
own.

**What is kept:** `found` and `not-found` answers, the allow-list already applied, so nothing beyond
the connector's fields is ever held. A failure is never kept, so a system that is down is asked
again at the next card. `no-key` asks nothing, and is not kept.

**A refresh,** `"refresh": true`, is the `Cache-Control: no-cache` of this cache: the system is
asked, and its answer kept. It is an administrator's only, so that no reader can make every card
they draw a call; the card never sends it.

**How old an answer is:** as old as the moment the system was asked for it, not the moment its
answer came back, so a slow call's answer is not passed off as younger than it is.

**Dropped:** at its time to live, when a change event names its key, when the connector is
contributed again or removed, and when the server stops. A call already on its way when an event
names its key keeps nothing, since the system may have answered before its record changed: each
event is remembered for at least 35 seconds, longer than any call may last, also when the connector
is contributed again. A slower call's answer never replaces one asked later. Which came first is
told by one counter, not the clock, so a clock set back changes nothing; past the bound, an
expired answer goes before a good one, wherever it sits. Each server node keeps its own: an event received by one node drops that
node's answers, and the other nodes' live out their time to live.

**Metrics,** in the platform's registry (`MetricsService`), each tagged with the connector's id, so
Nuxeo's own reporters carry them: `nuxeo.connectors.cache.hits`, `.misses` (counted only while the
connector's cache is on), `.age`, a histogram of how old each answer given from the cache was in
seconds, `.refreshes` (while the cache is on) and `.invalidated`. The server log has a debug line for each hit, with its age,
and each miss, naming the connector and the document, never the key.

**The card says how old the answer is,** under its fields or under "Nothing found": "Read from the
other system just now", under a minute, or "Read from the other system 5 minutes ago", from `age`.
A layout has nothing to set for it, so the `external` card's configuration is as it was.

## Change events

A system of record tells Nuxeo that a record changed, and the answers kept for it are dropped, so
that the next card drawn asks again. **That is all an event does:** the servlet opens no session,
reads no document, writes nothing, in Nuxeo or anywhere, and begins no transaction of its own.

```
POST /nuxeo/agentic-connectors/events/payers.claimPayments
Content-Type: application/json
X-Nuxeo-Connector-Timestamp: 1795680000
X-Nuxeo-Connector-Nonce: 3f9a0c1e7b2d4a6f8e1c5d7b9a0c2e4f
X-Nuxeo-Connector-Signature: sha256=<64 hexadecimal digits>

{ "key": "CLAIM-000130" }
```

| Server property                               | Default    | What it does                                                                                    |
| --------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `nuxeo.agentic.connectors.<id>.events.secret` | Unset: off | The secret the connector's system signs its events with, at least 32 characters. Shorter is off |

1. **The path** names the connector: `/nuxeo/agentic-connectors/events/<id>`. Another method than
   `POST` is 405; a path that is not one connector id is 404.
2. **The body:** at most 4096 bytes, by its `Content-Length` or as it is read, else 413 and the rest
   is not read.
3. **The connector** must be one the server has, with an events secret: else 401.
4. **The timestamp,** whole seconds since 1970, must be within 300 seconds of the server's clock,
   either way: else 401.
5. **The nonce,** 16 to 128 letters, digits, `_` or `-`: else 401.
6. **The signature:** `sha256=` and the HMAC-SHA256, keyed with the secret's UTF-8 bytes, of the
   connector's id, the timestamp and the nonce, each followed by a line feed, then the body's bytes
   as sent. Compared in constant time (`MessageDigest.isEqual`): else 401.
7. **Not seen before:** the nonce must not have been used for the connector while its timestamp
   could still be accepted: else 401. Looked up and remembered at once, so two copies of one event
   sent together are one accepted and one refused. Only a signed event's nonce is remembered,
   until its timestamp leaves the window, expired ones forgotten every minute; at most 10000 per
   connector at once. Past that, 503: a system that sends more than that for one connector within
   five minutes should send the rest again.
8. **The event:** one JSON object whose `key` is a key as the connector sends it, one path segment;
   other members are ignored. Else 400: signed, but not an event.
9. **204**, once every answer kept for that connector and key is dropped, whichever document it was
   read for, however many there were. No other key's answer is touched.

Every refusal of who sent it is the same 401 with no body, an unknown connector's included, so that
the answer says nothing of which connectors take events to someone without the secret. Its timing
is not made the same: an unknown connector is refused before any signature is computed, and a
connector's id is no secret anyway, since a layout names it. The log names the reason,
and the connector only once it is one the server has; a refusal is logged at `WARN` once a minute
per connector and reason, and at debug otherwise, so that someone without the secret cannot fill
the log. Never the secret, the signature, the nonce, the key or the body. The metrics:
`nuxeo.connectors.events.accepted`, and `.refused` tagged with the reason, the connector
`(unknown)`, which no id can be, for one the server does not have.

**Signing one by hand,** with `openssl`, to check a system's signer against the server's:

```bash
printf '%s\n%s\n%s\n%s' "$CONNECTOR" "$TIMESTAMP" "$NONCE" "$BODY" \
  | openssl dgst -sha256 -hmac "$EVENTS_SECRET" -r | cut -d' ' -f1
```

The Java tests and the stand-in's selftest both hold their signers to one such vector, computed
this way from a secret derived from a phrase. The stand-in core system sends events too:
`node nuxeo-agentic-connectors/demo/core-system.mjs notify CLAIM-000130 --to <the address above>`,
with the secret in `CORE_SYSTEM_EVENTS_SECRET`.

## Outbound webhooks: not built

The plan's phase 7 names "events and webhooks". This slice builds the events that come in, and
**only** them. Outbound webhooks, Nuxeo telling another system that a document changed, are out of
its scope: they send data out of Nuxeo, to addresses outside it, on events the reader did not ask
for, and need their own design (what is sent and to whom, signing, retries, and their own security
review). Nothing here sends anything out of Nuxeo but `Connector.Read`'s one `GET`.

## The contribution

```xml
<component name="nuxeo.config.acme-connectors" version="1.0">
  <require>org.nuxeo.agentic.connectors</require>
  <extension target="org.nuxeo.agentic.connectors" point="connectors">
    <connector id="payers.claimPayments">
      <type>Claim</type>
      <address property="nuxeo.agentic.connectors.payers.claimPayments.address" />
      <path>/claims/{key}</path>
      <key xpath="claim:number" />
      <permission>Read</permission>
      <credential header="Authorization" prefix="Bearer "
                  property="nuxeo.agentic.connectors.payers.claimPayments.token"
                  env="NUXEO_CONNECTOR_PAYERS_CLAIMPAYMENTS_TOKEN" />
      <connectTimeout>2000</connectTimeout>
      <timeout>5000</timeout>
      <maxBytes>65536</maxBytes>
      <maxConcurrent>8</maxConcurrent>
      <field name="paymentStatus" pointer="/payment/status" />
      <field name="paidAmount" pointer="/payment/amount" />
    </connector>
  </extension>
</component>
```

| Element          | Required | Rule                                                                                                                                                                                |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Yes      | 1 to 64 letters, digits, `.`, `_` or `-`, starting with a letter: what a layout's `external.connector` names                                                                        |
| `type`           | 1 to 20  | The document types it reads a key from, and the only ones                                                                                                                           |
| `address`        | Yes      | `property`: the server property that holds the address, `nuxeo.agentic.connectors.<id>.<name>`. Never the address itself                                                            |
| `path`           | Yes      | Starts with `/`, holds `{key}` once, otherwise only letters, digits, `/`, `.`, `_`, `~`, `-`; no empty, `.` or `..` segment, no query                                               |
| `key`            | Yes      | `xpath`: the document property that holds the key, `prefix:name`                                                                                                                    |
| `field`          | 1 to 50  | `name`: letters, digits and `_`, starting with a letter. `pointer`: a JSON pointer into the answer, `/<name>` by default                                                            |
| `permission`     | No       | A Nuxeo permission. Default `Read`                                                                                                                                                  |
| `credential`     | No       | `header` (not `Host`, `Cookie`, `Proxy-*` or another that changes where the request goes), `prefix` (kept as written, up to 32 printable characters), and `property`, `env` or both |
| `connectTimeout` | No       | 100 to 10000 ms. Default 2000                                                                                                                                                       |
| `timeout`        | No       | The whole call: 100 to 30000 ms. Default 5000                                                                                                                                       |
| `maxBytes`       | No       | 1024 to 1048576. Default 262144                                                                                                                                                     |
| `maxConcurrent`  | No       | The calls running at once, 1 to 64. Default 8                                                                                                                                       |

The settings a connector names are its own: a credential's `property` is under
`nuxeo.agentic.connectors.<id>.` too, and its `env` is `NUXEO_CONNECTOR_<ID>_<NAME>`, the id in
capitals with `.` and `-` as `_`. Each is one name after the connector's own prefix, so a connector
`payers` cannot name `payers.claimPayments`'s token, and two ids that share an environment prefix,
`a.b` and `a_b`, are not both registered. An id may not end in `.http`, `.cache` or `.events`: the
server's own settings for a connector are two names under its prefix, `<id>.http.allowed`,
`<id>.cache.ttl`, `<id>.cache.maxEntries` and `<id>.events.secret`, and a connector `payers.events`
could otherwise name `payers`'s events secret as its credential. So a contribution cannot have
another of the server's settings, a database password or another connector's events secret say,
sent to its address.

A connector that breaks a rule is not registered, and the log names every problem; one registered
earlier under its id stays. A later contribution with the same id replaces it whole, and
`enabled="false"` removes it.

## How a kit opts in: Payers, for example

**Not done here:** the Payers kit's files are not touched. To show its claims' payments, the kit
would:

1. **Contribute the connector** in its bundle: a component like
   `demo/payers-claim-payments-config.xml`, say `bundle/OSGI-INF/payers-claims-demo-connectors.xml`,
   named in the bundle's `MANIFEST.MF`, with `<require>org.nuxeo.agentic.connectors</require>`.
2. **Depend on the add-on's package** in `package/package.xml`, once it has one (below).
3. **Add the card** to `layouts/Claim/view.layout.json`, as `demo/Claim.view.layout.json`'s
   `payment` card does, with a `labelKey` and its label in `labels/en.json`.
4. **List the connector for the pipeline**, so that the card's fields are held to the allow-list:
   `npm run app-package -- business-apps/packages/payers-claims-demo --registered <a file like demo/registered.json>`.
5. **Say in its README** which server properties each server sets: the address, the credential,
   the time to live and the events secret if it uses them, and, on a demo server only,
   `nuxeo.agentic.connectors.payers.claimPayments.http.allowed`.

## Building it

Java 21 and Maven, with the Nuxeo public repository the parent POM names.

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # or any JDK 21
mvn -B -pl nuxeo-agentic-connectors -am verify
# target/nuxeo-agentic-connectors-2026.0.2-SNAPSHOT.jar, after 109 tests
node nuxeo-agentic-connectors/demo/core-system.selftest.mjs   # 16 of 16
```

The Nuxeo test framework's runtime needs what `nuxeo-agentic-documents` and `nuxeo-agentic-assets`
need for it, and the pom says why: Chronicle 2.25, ASM 9.7 and the JDK packages opened to it. The
root `pom.xml` lists the module, so a full reactor build builds it too. The Marketplace build
(`build-marketplace.yml`) builds `nuxeo-agentic-ui-package` and what it needs, and does not package
this add-on: **it has no Marketplace package yet**, which a release needs.

## Installing it on the local Docker Nuxeo, for the demo

For the reviewer, after review. Each step changes the server; none was run here.

```bash
# 1. The bundle, and the demo's connector.
docker cp nuxeo-agentic-connectors/target/nuxeo-agentic-connectors-2026.0.2-SNAPSHOT.jar \
  nuxeo:/opt/nuxeo/server/nxserver/bundles/nuxeo-agentic-connectors.jar
docker cp nuxeo-agentic-connectors/demo/payers-claim-payments-config.xml \
  nuxeo:/opt/nuxeo/server/nxserver/config/payers-claim-payments-config.xml

# 2. The server's settings: the address, plain http for the stub, a made-up demo token, a
#    5-minute cache and a made-up events secret, appended to nuxeo.conf itself through standard
#    input, so neither secret is on a command line.
export CORE_SYSTEM_TOKEN=$(openssl rand -hex 16)
export CORE_SYSTEM_EVENTS_SECRET=$(openssl rand -hex 32)
umask 077
P=nuxeo.agentic.connectors.payers.claimPayments
printf '%s.address=http://host.docker.internal:8091\n%s.http.allowed=true\n%s.token=%s\n%s.cache.ttl=300\n%s.events.secret=%s\n' \
  "$P" "$P" "$P" "$CORE_SYSTEM_TOKEN" "$P" "$P" "$CORE_SYSTEM_EVENTS_SECRET" > /tmp/70-connectors-demo.conf
docker exec -i nuxeo sh -c 'cat >> /etc/nuxeo/nuxeo.conf' < /tmp/70-connectors-demo.conf
rm /tmp/70-connectors-demo.conf

# 3. Restart, and check the settings and the operation are there: 5 lines, and the operation.
docker restart nuxeo
docker exec nuxeo grep -c '^nuxeo\.agentic\.connectors\.payers\.claimPayments\.' /etc/nuxeo/nuxeo.conf
curl -s -u "$NUXEO_USER:$NUXEO_PASS" http://localhost:8080/nuxeo/api/v1/automation/Connector.Read | head -c 200
```

**Not `/etc/nuxeo/conf.d/`, on a container that has started before.** The image's
`/docker-entrypoint.sh` merges `conf.d` into `/etc/nuxeo/nuxeo.conf` only at the container's
first start, before it writes its `configured` marker (read from the local 2025.10.18 container;
[`nuxeo-conf/README.md`](../nuxeo-conf/README.md) says so in its "Local mail setup"). A file
copied there later is never read, and the connector answers 503 for want of its address. On a
container not started yet, a `conf.d` file works.

The Payers kit must be installed and seeded (its README), so that claims with the numbers the
stub knows exist. To remove it all: delete the two files, delete the settings' lines from
`nuxeo.conf`, and restart:

```bash
docker exec nuxeo sed -i '/^nuxeo\.agentic\.connectors\.payers\.claimPayments\./d' /etc/nuxeo/nuxeo.conf
```

## The demo: a claim with live core-system data

1. **Start the stand-in core system**, in the shell that holds the token:
   `node nuxeo-agentic-connectors/demo/core-system.mjs` (port 8091, on 127.0.0.1; a container in
   Docker Desktop reaches it at `host.docker.internal`, as measured from the local `nuxeo`
   container).
2. **Serve the demo's Claim page:**
   `npm run config:dev -- --layout Claim/view=nuxeo-agentic-connectors/demo/Claim.view.layout.json`,
   then `npx nx serve nuxeo-ui`, and sign in as one of the Payers demo users.
3. **Open claim `CLAIM-000130`:** the Claim card from Nuxeo, and beside it "Payment and policy, from
   the core system": Paid, $412.50, the date, the reference, the policy and its status. The stub's
   `adjusterNotes` and `bankAccount` are never shown: the connector does not allow them, and they
   do not leave the server.
4. **The other states:** `CLAIM-000144` shows the error, with Retry (the stub answers 503);
   `CLAIM-000143` the error after the 5-second timeout (the stub waits 8); a claim the stub does not
   know, "Nothing found in the other system"; stopping the stub, the error again.
5. **The permission:** `Connector.Read` called directly, with `curl`, as a user who may not read a
   claim, is refused, and the stub's log shows no request for it.
6. **The cache:** open `CLAIM-000130` again within 5 minutes. The card says "Read from the other
   system" and how long ago, and the stub's log shows no new request. As a user who may not read
   the claim, it is still refused, kept answer or not.
7. **A change event:** in the shell that holds the events secret,
   `node nuxeo-agentic-connectors/demo/core-system.mjs notify CLAIM-000130 --to http://localhost:8080/nuxeo/agentic-connectors/events/payers.claimPayments`
   prints `204`. Open the claim again: the stub's log shows a new request, and the card says "just
   now". The same command with a wrong secret prints `401`, and the kept answer stays.

Only the Claim page comes from the development server this way: add the kit's other files as its
README's "Seeing it under nx serve" does, to have the rest of the app beside it.

## What the security review must check

This calls out of the server, keeps what it read, and takes requests no one signed in to send. The
plan's phase 7 is not done until its security review is, and the review is deferred until the app
is finished ([security-reviews.md](../docs/business-apps/security-reviews.md)). These are notes
for it, not its findings.

- **Server-side request forgery.** The address is a server property, read on the server; the
  request names only a connector id and a document. The document's key is the one value from data,
  sent only as one path segment of unreserved characters (`SystemOfRecordClient.KEY`), and the
  joined address is held to the configured host and path (a check no input can reach today, kept
  as a second wall). No redirect is followed. Check: that no other value reaches the URL; that the
  base address check (`https`, host, no user, query or fragment) is enough for your network; and
  that each connector's `http.allowed` stays off outside demos. Internal addresses are allowed on
  purpose: a core system usually is one.
- **The allow-list.** Only `<field>` pointers are read, only scalars are returned, and the rest of
  the answer never leaves the server (`ConnectorAnswer.found`). The card's own list is a display
  choice, not a control, and so is the validator's address check on a layout. Check the
  contribution of every connector a kit ships.
- **Credentials.** From a server property or the environment only, named by the contribution and
  held to the connector's own names (`nuxeo.agentic.connectors.<id>.<name>`, `NUXEO_CONNECTOR_<ID>_<NAME>`), read
  per call, sent in one header, never logged, never in an answer or an error. Check: where each
  server keeps them (`nuxeo.conf`, and any `conf.d` file it was made from, readable by the Nuxeo
  user only), their rotation, and that the other system's account is read-only and scoped to what
  the connector needs.
- **Timeouts and size limits.** Connect timeout up to 10 s, a whole-call deadline up to 30 s, a
  body up to 1 MiB, at most 64 calls of a connector at once, each bounded in `Connector.of`. Check
  the defaults (2 s, 5 s, 256 KiB, 8) against the other system and the server's pools: a call
  blocks its request thread, inside the request's transaction, for up to its deadline, so 8 slow
  calls of each connector hold 8 threads and, on a database repository, their connections. There
  is **no per-user rate limit**, and unless the server sets the connector's time to live, every
  card drawn is one call; with one, a card drawn again is not, but readers who miss at once each
  call, up to `maxConcurrent`. The body of a 404 or
  another answer not read is cancelled, which closes its connection: the next call opens a new
  one, a new TLS handshake for an https system. That cancelling a call
  at its deadline closes its connection is the JDK's behaviour, not asserted by a test here.
- **The permission check.** `Read` on the document first, then the connector's stronger permission
  if it names one, before anything is sent (`ConnectorReader`); the key is read from the document
  as stored, not as the request sent it. Check three consequences:
  - **the other system's own access rules do not apply reader by reader**: the connector calls it
    with one service credential, and whoever may read the record sees its connector's fields.
    Passing the reader's identity on is decision F's token exchange;
  - **whoever can write the key on a document of the connector's types chooses which outside
    record is read.** That includes a user who may create such a document anywhere, a personal
    workspace say, where they hold every permission, so a stronger permission does not close it.
    A kit should key a connector on a property its users cannot set, such as one a workflow or an
    import writes, and limit where its types may be created;
  - **calls are not audited:** the log has one debug line per call, naming the connector and the
    document. Nuxeo's audit of who read which outside record is not written, nor of who was given
    a kept answer.
- **The cache's isolation.** The reader is not in the key; every check runs before the lookup, so
  a kept answer reaches only a reader who may read that document and would have had the same
  answer from the system ([The cache](#the-cache)). Check: that this still holds for every
  connector a kit ships, and that no connector's answer depends on who reads, which it would only
  if decision F passed the reader's identity on, when the reader must join the key.
- **What the cache holds, and for how long.** Only allowed fields, of `found` and `not-found`
  answers, in the server's memory, never on disk, for the time each server sets, up to a day.
  Check: each connector's time to live against how stale its data may be shown, and its
  `maxEntries` against the heap: at most that many answers, each at most the connector's
  `maxBytes`. A record that changes in the system shows its old fields until its time passes or
  an event names it, and, on a cluster, until every node's time passes: an event drops the answers
  of the node it reaches only.
- **The read past the cache.** `refresh` is an administrator's only (`NuxeoPrincipal.isAdministrator`),
  checked after the reader's permissions and before the document is read. Check that no other
  path asks past the cache.
- **The change events' endpoint.** `/nuxeo/agentic-connectors/events/*` has no authentication
  filter, on purpose, as `/agentic-ui-config/*` and `/agentic-share/*` have none: the events
  secret is what authenticates. Check:
  - **the signature:** HMAC-SHA256 over the connector's id, the timestamp, the nonce and the body,
    compared with `MessageDigest.isEqual`, with a secret of at least 32 characters. The id in what
    is signed means a secret shared by two connectors still cannot carry one's event to the other;
  - **the replay window:** 300 seconds either way of the server's clock, and each nonce remembered
    in memory, per connector and per node, while its timestamp could be accepted. A replay to
    another node of a cluster, inside the window, is accepted there: it drops what that node
    keeps, and costs one call per card;
  - **what an event can do:** drop kept answers, nothing else. It opens no session and writes
    nothing (`ChangeEventRuntimeTest.anEventWritesNoDocument`). The worst a holder of the secret
    can do is make cards call the system, as an empty cache does;
  - **what it answers:** one 401 for every refusal of who sent it, a connector the server does not
    have included, though not in the same time, and the log throttled to one `WARN` a minute per
    connector and reason, so that someone without the secret learns nothing from the answer and
    cannot fill the log;
  - **the secret:** a server property only, `nuxeo.agentic.connectors.<id>.events.secret`, read per
    event, never logged (`ConnectorLogTest`), and never a name a contribution may give its
    credential. Where each server keeps it, and its rotation: one secret at a time, so a system's
    events are refused between the server's change and the system's;
  - **the network:** whether the endpoint should be reachable from the system of record's network
    only, at the proxy in front of Nuxeo. The server's filters on every path, its CORS and CSRF
    filter among them, still run on it, and how they treat a `POST` from a system with no
    `Origin` is the platform's.

## Not done, and not checked

- **On a server:** nothing. That Automation answers this operation's 403, 404, 502, 503 and 504 with
  those statuses, and that a component in `nxserver/config/` registers the connector, are Nuxeo's
  documented behaviour, not checked by a run on a server. In the Nuxeo test framework's runtime
  (11.5's), the Automation service runs `Connector.Read`, `@Context ConnectorService` injects the
  component, and its `refresh` parameter reaches it. That the servlet is mapped from
  `deployment-fragment.xml` is the mechanism `nuxeo-agentic-core`'s servlets use, which are in the
  local 2025.10.18 server's `web.xml`; the servlet itself is run by the tests through a bridge, not
  by Tomcat. The metrics' classes and methods are in the 2025.10.18 server's jars with the same
  signatures, read from them, not run there.
- **Across a cluster:** an event drops the answers of the node it reaches, and remembers its nonce
  there only. Dropping them on every node, through the platform's pub/sub, is not built.
- **Outbound webhooks:** out of this slice's scope ([above](#outbound-webhooks-not-built)).
- **A Marketplace package** for the add-on, and the pipeline reading a kit's own connector
  contributions instead of a `--registered` file.
- **Hot reload:** unregistering a contribution that replaced another removes the connector rather
  than bringing the earlier one back, and an `enabled="false"` removal is not undone. Only a
  development server's hot reload unregisters.
- **The rest of the plan's connectors add-on:** outbound webhooks, fields synced in, a real
  connector chosen with presales, a query parameter for the key, embedded panels (decision F).
