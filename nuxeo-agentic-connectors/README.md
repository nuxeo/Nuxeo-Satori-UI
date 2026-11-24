# Nuxeo Agentic Connectors

Records that live elsewhere: live data from a system of record on a record page. The first slice of
phase 7 of the business apps [development plan](../docs/business-apps/development-plan.md), built on
the recommendation of decision D, "inside Nuxeo as an add-on; a separate service only when one needs
it" ([decision log](../docs/business-apps/decisions.md)). The decision is still open, and the log's
note says what changes if it goes another way.

**Nothing here is installed on any server yet.** It is proven by its Java tests, against a stub of
the other system on the loopback interface, by the client's tests and by the validator. The
install and the demo below are for the reviewer.

## The short version

- **A kit contributes a connector**, a server component: which document property holds the key,
  the path on the other system, the fields that may come back, and the names of the server
  settings that hold the address and the credential.
- **Each server sets the address and the credential**, in `nuxeo.conf` (the credential also from
  the environment). Neither is ever in a contribution, a document, a layout or a request.
- **`Connector.Read`**, an Automation operation, reads one record for a document: it checks the
  reader's permission on the document, reads the key, calls the other system once within the
  connector's bounds, and returns only the allowed fields, as JSON.
- **Layout version 2's `external` card** shows the answer on the record page, with loading, empty
  and error states ([layout-v2.md](../docs/business-apps/layout-v2.md), section 7). The validator
  checks it: no address anywhere in the card, field names that are names, the widgets that show one
  value as text, and, given the server's connectors, each field against its connector's allow-list.

## What is in it

| File                                                            | What it is                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/main/java/org/nuxeo/agentic/connectors/`                   | The bundle: the descriptor, its checks (`Connector.of`), the component and service, the HTTP call, the operation |
| `src/main/resources/OSGI-INF/connectors-service.xml`            | The component `org.nuxeo.agentic.connectors`, its service and its `connectors` extension point                   |
| `src/main/resources/OSGI-INF/connectors-operations-contrib.xml` | Registers `Connector.Read`                                                                                       |
| `src/test/java/`                                                | 54 tests, with an embedded HTTP stub (`SystemOfRecordStub`); no Nuxeo runtime                                    |
| `demo/core-system.mjs`                                          | The stand-in core claims system: fictional payment and policy records for the Payers seed's claims               |
| `demo/core-system.selftest.mjs`                                 | Its controls, 10 of them                                                                                         |
| `demo/payers-claim-payments-config.xml`                         | The demo's connector, `payers.claimPayments`, keyed on `claim:number`                                            |
| `demo/Claim.view.layout.json`                                   | A Claim record page with the `external` card, for the development server                                         |
| `demo/registered.json`                                          | The connector's fields, as the validator and the package pipeline are given them with `--registered`             |

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
4. **The stored document:** `session.getDocument(ref)`. The key is read from it, never from the
   document the request gave: Automation builds an input document from a JSON entity and applies
   the entity's properties to it in memory, so a reader could otherwise send any key.
5. **Its type** must be one of the connector's `<type>`s; another answers `no-key`, and nothing is
   sent.
6. **The key:** the `<key xpath>` property, a text or a whole number, trimmed. It is sent only when
   it is one path segment of letters, digits, `.`, `_` or `-`, starting with a letter or a digit.
   Anything else, or none, answers `no-key`, and nothing is sent.
7. **The address:** the server property `<address property>` names: `https` with a host and no
   user, query or fragment; plain `http` only where the server sets
   `nuxeo.agentic.connectors.<id>.http.allowed=true` for this connector. Missing or unusable: 503,
   and nothing is sent. A host name Java's `URI` does not read, such as a Docker Compose service
   with an `_`, is unusable.
8. **The credential**, if the connector has one: the server property it names, else the environment
   variable. Missing, or holding a character a header may not carry: 503, and nothing is sent.
9. **At most `maxConcurrent` calls** of the connector at once: one past it is refused at once, 503,
   rather than queued, so that a slow system holds no more of the server's request threads.
10. **One `GET`** to the address plus the path, `{key}` replaced, over HTTP/1.1, with
    `Accept: application/json` and the credential's header. **No redirect is followed.**
11. **Bounds:** a connect timeout, and one deadline for the whole call, headers and body; a body over
    `maxBytes`, by its `Content-Length` or as it arrives, is refused, and the rest is not read. The
    body of any other answer than a 200 with a JSON type is cancelled unread.
12. **The answer:** a 200 with one JSON object is `found`, and only the connector's fields are read
    from it, each at its JSON pointer, each kept only when it is a text, a number or a boolean. A
    404 is `not-found`. A redirect, any other status, another content type, or anything that is
    not one JSON object is 502; a timeout is 504.

```json
{
  "connector": "payers.claimPayments",
  "status": "found",
  "fields": { "paymentStatus": "Paid", "paidAmount": 412.5 }
}
```

A failure's message is one neutral sentence per kind (`ConnectorException`): never the address, the
key, the credential or what the other system said. The log names the connector, the kind and the
class of the cause, and never the key, which may be personal data.

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
`a.b` and `a_b`, are not both registered. An id may not end in `.http`. So a contribution
cannot have another of the server's settings, a database password say, sent to its address.

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
   and, on a demo server only, `nuxeo.agentic.connectors.payers.claimPayments.http.allowed`.

## Building it

Java 21 and Maven, with the Nuxeo public repository the parent POM names.

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # or any JDK 21
mvn -B -f nuxeo-agentic-connectors/pom.xml package
# target/nuxeo-agentic-connectors-2026.0.2-SNAPSHOT.jar, after 54 tests
node nuxeo-agentic-connectors/demo/core-system.selftest.mjs   # 10 of 10
```

The root `pom.xml` lists the module, so a full reactor build builds it too. The Marketplace build
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

# 2. The server's settings: the address, plain http for the stub, and a made-up demo token.
export CORE_SYSTEM_TOKEN=$(openssl rand -hex 16)
umask 077
P=nuxeo.agentic.connectors.payers.claimPayments
printf '%s.address=http://host.docker.internal:8091\n%s.http.allowed=true\n%s.token=%s\n' \
  "$P" "$P" "$P" "$CORE_SYSTEM_TOKEN" > /tmp/70-connectors-demo.conf
docker cp /tmp/70-connectors-demo.conf nuxeo:/etc/nuxeo/conf.d/70-connectors-demo.conf
rm /tmp/70-connectors-demo.conf

# 3. Restart, and check the operation is there.
docker restart nuxeo
curl -s -u "$NUXEO_USER:$NUXEO_PASS" http://localhost:8080/nuxeo/api/v1/automation/Connector.Read | head -c 200
```

The Payers kit must be installed and seeded (its README), so that claims with the numbers the
stub knows exist. To remove it all: delete the two files and the `conf.d` file, and restart.

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

Only the Claim page comes from the development server this way: add the kit's other files as its
README's "Seeing it under nx serve" does, to have the rest of the app beside it.

## What the security review must check

This calls out of the server. The plan's phase 7 is not done until its security review is.

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
  server keeps them (`conf.d` files readable by the Nuxeo user only), their rotation, and that the
  other system's account is read-only and scoped to what the connector needs.
- **Timeouts and size limits.** Connect timeout up to 10 s, a whole-call deadline up to 30 s, a
  body up to 1 MiB, at most 64 calls of a connector at once, each bounded in `Connector.of`. Check
  the defaults (2 s, 5 s, 256 KiB, 8) against the other system and the server's pools: a call
  blocks its request thread, inside the request's transaction, for up to its deadline, so 8 slow
  calls of each connector hold 8 threads and, on a database repository, their connections. There
  is **no per-user rate limit and no cache**: every card drawn is one call. The body of a 404 or
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
    document. Nuxeo's audit of who read which outside record is not written.

## Not done, and not checked

- **On a server:** nothing. That Automation answers this operation's 403, 404, 502, 503 and 504 with
  those statuses, that `@Context ConnectorService` injects the service, and that a component in
  `nxserver/config/` registers the connector are Nuxeo's documented behaviour, checked here against
  the 2025.10.18 jars' bytecode where they could be (`OperationContext.getAdapter` falls back to
  `Framework.getService`), not by a run.
- **A Marketplace package** for the add-on, and the pipeline reading a kit's own connector
  contributions instead of a `--registered` file.
- **Hot reload:** unregistering a contribution that replaced another removes the connector rather
  than bringing the earlier one back, and an `enabled="false"` removal is not undone. Only a
  development server's hot reload unregisters.
- **The rest of the plan's connectors add-on:** caching, events and webhooks, fields synced in, a
  real connector chosen with presales, a query parameter for the key, embedded panels.
