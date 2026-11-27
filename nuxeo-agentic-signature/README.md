# Nuxeo Agentic Signature

The e-signature step: a record's file sent for signature to named signers, the provider's callback
authenticated, and the signed file filed on the record as a new version, with the provider's
evidence. The first slice of phase 7's "the e-signature step" in the business apps
[development plan](../docs/business-apps/development-plan.md), for its demo step 4, "An onboarding
case: KYC checklist, e-signature, the signed file filed", with the
[onboarding kit](../business-apps/packages/onboarding-demo/README.md).

Built on decision B's recommendation, one add-on per domain module, and **with no vendor chosen**:
decision H, the e-signature service, is chosen with procurement and presales
([decision log](../docs/business-apps/decisions.md)). So the add-on is provider-neutral, and its one
provider is a stand-in, which talks to a stand-in service that signs nothing.

**Nothing here is installed on any server yet.** It is proven by its tests, in Nuxeo's own test
framework, against a stub of the stand-in service and against the stand-in service itself, and by
the service's selftest. The install and the demo below are for the reviewer.

## The short version

- **A kit gives its types the add-on's facets.** A record whose files may be signed carries
  `Signable` (schema `signable`, prefix `sgn`) and keeps versions. A signature request type carries
  `SignatureRequest` (`signature_request`, `sigreq`).
- **A request is sent when it is created,** by someone who may write its record: it names the
  record, one of its files (an attachment by its file name, or with none the main file), one to ten
  signers by name and email, and a message. The file goes to the provider the server configures,
  and the record is marked out for signature. No Automation operation: a person creates a request
  as every client creates a document, through the app's Create form, and a workflow's chain may
  create one the same way.
- **The provider's callback is authenticated before it is parsed,** at
  `/nuxeo/agentic-signature/callback/<provider>`, with no sign-in: a signature over its time and
  body, made with a secret the server and the provider share, compared in constant time; its time
  within five minutes of the server's; its id taken once, across the cluster. Only then may it end
  the request, signed or declined, and only when the provider's own service, asked with the
  server's credential, says the same.
- **Signed, the signed file is fetched from the provider** and takes the sent file's place on the
  record, which is checked in as a new major version with the provider's evidence on it; a file
  changed since it was sent is not written over, and the signed one goes beside it. The request
  keeps the signed file, the evidence, their SHA-256 and the version's id.
- **Provider credentials are server settings only,** in `nuxeo.conf` or the environment: never in a
  contribution, a document or a request, and never in a log line, which a test holds to.
- **What no one but the server changes:** a request once sent, but for its cancelling by its
  requester or an administrator; a record's `sgn:` properties; the file out for signature, while it
  is out. **What is kept:** a request, a record while it is out, a folder holding either, and the
  signed version. No one trashes one while it is out, or restores a record out to a version; an
  administrator alone deletes a request, its envelope voided when it is out.

## What is in it

| File                                                         | What it is                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `src/main/java/org/nuxeo/agentic/signature/`                 | The bundle: the provider interface and its types, the service, the listener, the callback's endpoint |
| `src/main/java/org/nuxeo/agentic/signature/standin/`         | The stand-in provider, `StandInProvider`                                                             |
| `src/main/resources/OSGI-INF/signature-schema-contrib.xml`   | The two facets and their schemas                                                                     |
| `src/main/resources/OSGI-INF/signature-service.xml`          | The component `org.nuxeo.agentic.signature`, its service and its `providers` extension point         |
| `src/main/resources/OSGI-INF/signature-standin-contrib.xml`  | Registers the stand-in, `standin`: inert until the server configures it                              |
| `src/main/resources/OSGI-INF/signature-listener-contrib.xml` | The listener: sending, cancelling, and the guards                                                    |
| `src/main/resources/OSGI-INF/deployment-fragment.xml`        | The callback's servlet, at `/nuxeo/agentic-signature/*`, with no authentication filter               |
| `src/main/package/`                                          | The Marketplace package, `nuxeo-agentic-signature` 0.1.0                                             |
| `src/test/java/`                                             | 74 tests: 60 in Nuxeo's test framework, 12 with no runtime, 2 against the stand-in service           |
| `demo/esign-stand-in.mjs`                                    | The stand-in e-signature service: takes envelopes, a demo signer signs or declines, it calls back    |
| `demo/esign-stand-in.selftest.mjs`                           | Its controls, 16 of them                                                                             |

## The model

**`Signable`, on a kit's record type.** Every property is the server's.

| Property                        | What it holds                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `sgn:status`                    | `sent`, `signed`, `declined` or `cancelled`: its latest request's. None before the first  |
| `sgn:request`                   | That request, by id                                                                       |
| `sgn:signers`                   | The signers' names, not their addresses                                                   |
| `sgn:sentAt`, `sgn:completedAt` | When it was sent, and when it ended                                                       |
| `sgn:file`                      | Where the file sent is, `file:content` or `files:files/<n>/file`, and then the signed one |
| `sgn:fileDigest`                | While it is out: the file's digest, length and name, which may not change                 |
| `sgn:evidence`                  | The provider's evidence, on the version that holds the signed file and every one after    |

The type must be versionable, the `Versionable` facet and the `uid` schema: the signed file is
filed as a version, and a request naming a record that keeps none is refused.

**`SignatureRequest`, on a kit's request type.** The requester gives the first four properties;
the rest are the server's.

| Property                                                  | Given by  | What it holds                                                                   |
| --------------------------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `sigreq:document`                                         | Requester | The record, by id                                                               |
| `sigreq:fileName`                                         | Requester | An attachment's file name, as `files:files` lists it; none for `file:content`   |
| `sigreq:signers`                                          | Requester | One to ten, each `name` (200 characters at most) and `email`, each address once |
| `sigreq:message`                                          | Requester | What the signers are told, 1,000 characters at most; the title is the subject   |
| `sigreq:status`                                           | Server    | `sent`, then `signed`, `declined` or `cancelled`                                |
| `sigreq:provider`, `sigreq:envelope`                      | Server    | The provider, by id, and its envelope's id there                                |
| `sigreq:file`, `sigreq:sentFileName`, `sigreq:sentDigest` | Server    | Where the file was, its name, and the SHA-256 of the bytes sent                 |
| `sigreq:requestedBy`, `sigreq:requestedAt`                | Server    | Who sent it, and when                                                           |
| `sigreq:completedAt`, `sigreq:event`                      | Server    | When it ended, and the provider's id of the callback that ended it              |
| `sigreq:declineReason`, `sigreq:cancelledBy`              | Server    | A decline's reason, as the provider gave it; who cancelled                      |
| `sigreq:signedFile`, `sigreq:signedDigest`                | Server    | The signed file as it came back, and its SHA-256                                |
| `sigreq:evidence`, `sigreq:evidenceDigest`                | Server    | The provider's evidence, and its SHA-256                                        |
| `sigreq:signedVersion`                                    | Server    | The record's version that holds the signed file, by id                          |

## How a send goes

The listener, `SignatureRequestListener`, synchronous, in the transaction of the creation, as the
requester. Every refusal rolls the creation back, with the status the REST API answers.

1. **Nothing of the server's is given:** a request that sets any server property is 400.
2. **The request:** a title of 200 characters at most, one to ten signers each with a name and an
   address of the add-on's form, each address once, a message of 1,000 characters at most; 400
   otherwise. No control character in any of them.
3. **The record, read as the requester:** none is 400, one they may not read 403; it must carry
   `Signable` (400), be live and not in the trash (400, 409), and keep versions (400). **The
   requester may write it** (`Write`): 403 otherwise, since its signed file will be filed on it.
4. **Not out already:** a record whose `sgn:status` is `sent` is 409, and so is one being sent at
   this moment, by a claim in the key/value store that holds across the cluster.
5. **The file:** the attachment of that name, exactly one (none is 400, two 409), or the main file.
6. **The provider:** the one `nuxeo.agentic.signature.provider` names, registered and configured;
   none is 503, and nothing is sent. The file must be of a type it takes (the stand-in: PDF), and a
   PDF's bytes must begin as one; at most its size (10 MiB), read whole and no further.
7. **Sent:** the file, its SHA-256, the signers, the subject and the message go to the provider,
   which answers its envelope's id, one path segment. A service that fails or refuses is 503, with
   the kind's one sentence, never what the service said.
8. **Saved:** the request gets its status, provider, envelope, file, digest, requester and time.
   If its transaction does not commit, the envelope is voided at the provider, so that no one signs
   what the server never kept. Then the record is marked out for signature, as the requester.

## How a callback goes

`CallbackServlet` gives `CallbackEndpoint` the method, the path, the headers by lower-case name
(64 at most, each 4 KiB at most) and at most 64 KiB of body; a larger one is 413, by its declared
length unread, or as it arrives. Each answer is a few fixed words as JSON, and names nothing of the
callback, the request or the record.

1. **`POST` to `/callback/<provider id>`,** a provider registered here: any other path is 404, any
   other method 405, a provider the server has not configured 503.
2. **Authenticated, by the provider** (`SignatureProvider.authenticate`). The stand-in's: the
   header `X-StandIn-Signature: t=<unix seconds>,v1=<64 hex>`, which must be exactly that form,
   and `v1` the HMAC-SHA256 of `<t>.<body>` under the callback secret, compared with
   `MessageDigest.isEqual`. The body is parsed only once it matches. Anything else is 401.
3. **Fresh:** `t` within the window of the server's clock, either way, 5 minutes by default. A stale
   or future callback is 401.
4. **Taken once:** its id is claimed in the key/value store for twice the window and a minute, past
   which its time is stale anyway. A callback whose id ended a request already is a replay, or a
   redelivery whose first answer the provider lost: nothing is done, and it is answered 200,
   "already received", so that a provider stops redelivering it. One whose first delivery is still
   under way is 409, retried, since that delivery may yet fail. A claim is released when its
   callback ended nothing, so that the provider's retry of it can.
5. **Its request:** by the provider and the envelope, both one segment of letters, digits, `.`,
   `_` and `-`, so nothing in the query is quoted from outside. None is 404, which a provider
   retries, since a send may not have committed yet; one no longer out is 200, "no longer out", and
   nothing is done; one being ended at this moment by another callback or a cancelling is 409,
   retried.
6. **Signed:** `fetchSigned`, with the server's credential: the provider's own service must say the
   envelope is signed, and give a file whose SHA-256 is the one it states; otherwise 502, retried.
   A file of a type the provider does not take, or evidence the add-on does not keep (JSON, PDF, XML
   or text, 5 MiB at most), is 422, which retrying cannot change, logged as an error. The signed
   file takes the sent file's place, named `<name>-signed.<ext>`, when the record's file there is
   still the bytes sent, by their SHA-256; otherwise it goes beside it, as a new attachment, and
   nothing is written over. The evidence goes in `sgn:evidence`, and the record is checked in as a
   new major version, as the system. **A record under a legal hold** keeps its files as they are,
   which `nuxeo-agentic-records` refuses to change for anyone: the signed file is kept on the
   request alone, the record says it is signed, no version is made, and the callback is taken
   rather than refused and retried for ever
   (`aRecordUnderALegalHoldKeepsItsFilesAndTheSignedFileStaysOnTheRequest`, seen failing with the
   check taken out: the callback answered 503). **Declined:** `status`, with the server's credential: the
   service must say the envelope is declined, or it is 502 and nothing ends; then the request and
   the record say so, with the reason, control characters dropped, 1,000 characters at most.
   **Anything else** the provider sends is taken, and changes nothing.

Every step after authentication runs in one transaction; a failure rolls it back, and is 502 or
503, so the provider retries. Anonymous refusals are logged at `INFO`, as users' refusals are, so
that requests to an address that needs no sign-in cannot fill the log with warnings.

## The guards

| What                                                          | Who may                                                                           |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Change a request once sent                                    | No one; its requester or an administrator cancels it while it is out              |
| Change a record's `sgn:` properties                           | The server only: a mark on its own writes, taken off by the write it lets through |
| Change, move or remove the file out for signature             | No one, while it is out                                                           |
| Copy a request, or a folder holding one                       | No one. A copied record, or one in a copied folder, is not out: `sgn:` is emptied |
| Trash a request out, a record out, or a folder holding either | No one: trash is undone, and a voided envelope is not                             |
| Delete a request, or a folder holding one                     | An administrator; a request out has its envelope voided, and its record released  |
| Delete a record out, or a folder holding one                  | An administrator                                                                  |
| Delete the version that holds a signed file                   | An administrator                                                                  |
| Restore a record out to a version                             | No one. Restored otherwise, its `sgn:` is its latest request's again              |

Nuxeo tells a folder's copy, removal and trash at its root only, so the folder answers for what it
holds, by a query of its descendants as the system, and a record in a trashed folder, which the
bulk trash reaches later, is not sent; so no child of a bulk trash is refused part way. A restored
signed record names its signed file only where the signed bytes are, which a version from before
the signing has not.

## The provider interface

`org.nuxeo.agentic.signature.SignatureProvider`, registered by a contribution:

```xml
<extension target="org.nuxeo.agentic.signature" point="providers">
  <provider id="standin" class="org.nuxeo.agentic.signature.standin.StandInProvider" />
</extension>
```

| Method                    | What a provider does                                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init(id, settings)`      | Keeps its id and where its settings are read, `SignatureSettings`: the server's properties and environment                                                                                                                                     |
| `configured()`            | Whether the server has given it all it needs to send and to authenticate a callback                                                                                                                                                            |
| `maxBytes()`, `accepts()` | The largest file it sends, and the types it takes: 10 MiB and PDF by default                                                                                                                                                                   |
| `send(Envelope)`          | Sends the file to its signers; answers the envelope's id                                                                                                                                                                                       |
| `authenticate(Callback)`  | Authenticates a callback by its scheme, in constant time, and only then reads it: the callback's id, the envelope, signed, declined or other, a time its signature covers, and a decline's reason. Throws `CallbackRefusedException` otherwise |
| `fetchSigned(envelope)`   | The signed file and the evidence, from its service, for an envelope it says is signed                                                                                                                                                          |
| `status(envelope)`        | Where the envelope is, as its service says: out, signed, declined or voided                                                                                                                                                                    |
| `cancel(envelope)`        | Voids an envelope                                                                                                                                                                                                                              |

It reads its credentials from `SignatureSettings` only, under `nuxeo.agentic.signature.<id>.`,
bounds every call (a connect timeout, a deadline for the whole call, the bytes read, no redirect
followed), and throws `SignatureProviderException` with a kind, whose message is the kind's one
sentence. The add-on keeps what does not depend on the provider: who may send what, the states,
one request out per record, the window and the replay claim, and filing. **A vendor chosen under
decision H is one class of this interface and its settings,** and nothing else here changes: the
kit's files do not.

## The stand-in

**The provider,** `StandInProvider`, for development and demonstration servers:

| Setting                                                                                                          | What it is                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `nuxeo.agentic.signature.provider=standin`                                                                       | Use it                                                                             |
| `nuxeo.agentic.signature.standin.address`                                                                        | The service: `https`, a host, no user, query or fragment                           |
| `nuxeo.agentic.signature.standin.http.allowed=true`                                                              | Lets the address be plain `http`: for a demo on one machine only                   |
| `nuxeo.agentic.signature.standin.apiKey`, or `NUXEO_SIGNATURE_STANDIN_API_KEY`                                   | Sent as a bearer token on every call. A character a header may not carry: unused   |
| `nuxeo.agentic.signature.standin.callbackSecret`, or `NUXEO_SIGNATURE_STANDIN_CALLBACK_SECRET`                   | The callbacks' shared secret, 32 characters at least: shorter, unused              |
| `nuxeo.agentic.signature.standin.callbackSecret.previous`, or `NUXEO_SIGNATURE_STANDIN_CALLBACK_SECRET_PREVIOUS` | While the secret is rotated: the one before, taken too, compared whichever matches |
| `nuxeo.agentic.signature.callback.window`                                                                        | The callback window, in seconds, 30 to 3600; 300 otherwise                         |

**The service,** `demo/esign-stand-in.mjs`, Node 24 and nothing else, in memory, on 127.0.0.1 by
default. It takes an envelope (`POST /envelopes`, the bearer key compared in constant time, the
file's SHA-256 checked), says where one is (`GET /envelopes/<id>`), gives a signed one's result
(`GET /envelopes/<id>/result`: the file with a line after the PDF's end saying it was not signed
for real, its SHA-256, and a JSON evidence naming both files' SHA-256 and the signers), voids one
(`DELETE`), and plays the signer: `POST /envelopes/<id>/sign` or `/decline` marks it and posts the
callback to `NUXEO_CALLBACK_URL`, signed as the provider checks it, again after 2, 5, 15, 30 and 60
seconds while Nuxeo does not answer 2xx. For the demo, `/resend` posts the last callback again,
signed anew, and `/forge` posts it signed with another secret. It logs methods, paths, statuses and
callback ids only.

```bash
node nuxeo-agentic-signature/demo/esign-stand-in.selftest.mjs   # 16 of 16
```

One of its controls holds its signing to the vector the Java tests hold the provider to, computed
with OpenSSL, and `StandInServiceTest` runs the provider against the service itself: send, each
status, the signer's callback, its authentication, the signed result; a decline and a void. Broken
on purpose three ways, the key's comparison always matching, no retry, and a resend signed with
another secret, the selftest went red each time.

## Building it

Java 21 and Maven, with the Nuxeo public repository the parent POM names.

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # or any JDK 21
mvn -B -f nuxeo-agentic-signature/pom.xml verify
# target/nuxeo-agentic-signature-0.1.0.zip, the Marketplace package, after 74 tests
```

The root `pom.xml` lists the module, and the Marketplace workflow (`build-marketplace.yml`) builds
and tests it, and runs the service's selftest, on the pull requests it sees; it does not publish it.
`StandInServiceTest` needs `node` on the path, which that job sets up: without it, its two tests
are skipped, and say so.

| Test                     | What it holds                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SendTest`, 19           | The file sent and the record marked; each refusal, with nothing sent and nothing saved; a record being sent at this moment; a service that fails, redirects or is not configured; an envelope voided when its request is not saved; a file changed while it is sent, not written over                                                                                                                         |
| `CallbackTest`, 16       | Signed: the file filed, a major version with the evidence; declined, and a decline the service does not confirm; another event; a forged, altered, stale, future, malformed, replayed or unknown callback refused; a duplicate and a late one acknowledged; a request ending at this moment; the service not saying signed, a tampered result, an unprocessable one; paths, methods, an unconfigured provider |
| `GuardTest`, 17          | A request not changed once sent; cancelling, by its requester or an administrator only, and not while a callback ends it; a request kept, deleted by an administrator, its envelope voided; not copied; `sgn:` the server's, a copy's too; the file out held; a record out not trashed or deleted; a folder's copy, removal and trash; a restore; the signed version kept                                     |
| `StandInProviderTest`, 8 | Settings and addresses; the OpenSSL vector; authentication, each refusal by its reason; the secret before, while it is rotated; nothing loggable holds a secret                                                                                                                                                                                                                                               |
| `CallbackServletTest`, 4 | The body's bound, declared and as it arrives; headers by lower-case name, bounded; the one refusal on a failure                                                                                                                                                                                                                                                                                               |
| `StandInServiceTest`, 2  | The provider against the stand-in service itself                                                                                                                                                                                                                                                                                                                                                              |
| `LogTest`, 1             | Every line the add-on logs, at every level, through sends, refusals and callbacks: no key, secret, signature, address or file                                                                                                                                                                                                                                                                                 |
| `BundleTest`, 6          | The components, the facets and schemas, the stand-in inert until configured, no Automation operation, the window, the version                                                                                                                                                                                                                                                                                 |

**Each guard was seen failing.** Thirty-five mutations of the code, one at a time, each turned at least
one of these tests red ([below](#how-the-guards-were-seen-failing)).

## How the guards were seen failing

Each mutation below was made to the code, one at a time, the named tests run, and the code put
back. One of them, the cancelling claim, stayed green at first, for want of a test: the test was written,
and it went red too.

| #     | The guard broken                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1-4   | The signature comparison always matching; no freshness window; no replay claim; an unknown envelope taken as found                                                             |
| 5-9   | Filing without the service saying signed; a decline it does not confirm; the signed file's digest not checked; no ending claim; an unacceptable result retried                 |
| 10-14 | A changed file written over; no `Write` check; no claim on a record being sent; server properties given by the requester; an envelope never saved not voided                   |
| 15-19 | The file out not held; anyone cancelling; no cancelling claim; `sgn:` writable by anyone; the server's mark left on the model after its write                                  |
| 20-24 | A folder holding requests copied; a folder's copy keeping its records out; a folder holding a request out deleted; a request out trashed; the envelope left on deletion        |
| 25-30 | A record out restored; a restored record keeping its version's `sgn:`; the signed version deletable; the API key logged; the secret before not taken; the servlet's bound      |
| 31-35 | A redelivery in hand acknowledged; a deleted request's record left held, alone or in a folder; a restored record naming a signed file it lacks; a trashed folder's record sent |

What was found and fixed while building, the independent review's two passes among it, is kept
outside this public repository, with the review pack
([security-reviews.md](../docs/business-apps/security-reviews.md)).

## Installing it on the local Docker Nuxeo, for the demo

For the reviewer, after review. Each step changes the server; none was run here.

```bash
# 1. The add-on's package, then the onboarding kit's (its README).
docker cp nuxeo-agentic-signature/target/nuxeo-agentic-signature-0.1.0.zip nuxeo:/tmp/
docker exec nuxeo nuxeoctl mp-install /tmp/nuxeo-agentic-signature-0.1.0.zip --accept=true

# 2. A made-up key and secret for the demo, in this shell only, and the settings appended to
#    nuxeo.conf through standard input, so neither is on a command line.
export STANDIN_API_KEY=$(openssl rand -hex 32) STANDIN_CALLBACK_SECRET=$(openssl rand -hex 32)
umask 077
P=nuxeo.agentic.signature
printf '%s.provider=standin\n%s.standin.address=http://host.docker.internal:8092\n%s.standin.http.allowed=true\n%s.standin.apiKey=%s\n%s.standin.callbackSecret=%s\n' \
  "$P" "$P" "$P" "$P" "$STANDIN_API_KEY" "$P" "$STANDIN_CALLBACK_SECRET" > /tmp/72-signature-demo.conf
docker exec -i nuxeo sh -c 'cat >> /etc/nuxeo/nuxeo.conf' < /tmp/72-signature-demo.conf
rm /tmp/72-signature-demo.conf

# 3. Restart, and the stand-in service in the same shell, calling back the server.
docker restart nuxeo
NUXEO_CALLBACK_URL=http://localhost:8080/nuxeo/agentic-signature/callback/standin \
  node nuxeo-agentic-signature/demo/esign-stand-in.mjs
```

The deployment fragment maps the servlet when the server is set up, at its start after the
install. Not `/etc/nuxeo/conf.d/` on a container that has started before: it is read at the first
start only ([`nuxeo-conf/README.md`](../nuxeo-conf/README.md)). To remove it: uninstall the
package, delete the settings' lines, and restart:

```bash
docker exec nuxeo sed -i '/^nuxeo\.agentic\.signature\./d' /etc/nuxeo/nuxeo.conf
```

## The demo: an agreement signed and filed

In the onboarding kit, once it is installed and seeded ([its README](../business-apps/packages/onboarding-demo/README.md#the-demo)):

1. An onboarding officer opens case `ONB-1003`: its KYC checklist done, its account agreement among
   its attachments.
2. In the onboarding register, Create, then Signature request: the case, the agreement's file name,
   the two directors as signers. Saved, it is sent; the case shows "out for signature".
3. `STANDIN_API_KEY=… node nuxeo-agentic-signature/demo/esign-stand-in.mjs sign <envelope>`, the
   envelope shown on the request's page.
4. The case shows the signed agreement in the agreement's place, "signed", and its history a new
   version, 1.0; the request shows the evidence's SHA-256 and links the version.
5. `resend <envelope>` posts the same callback again: the service's log shows Nuxeo's 200, "already
   received", and nothing changes; `forge <envelope>` shows Nuxeo's 401. `decline <envelope>
<reason>` on another case's request shows the decline.

## For the security review

What the review must check. The add-on's own tests hold each point below; they are not the review,
which is deferred until the app is finished, as every security review is
([security-reviews.md](../docs/business-apps/security-reviews.md)).

- **The callback's authentication.** The path takes no sign-in, so the signature is the only gate.
  Check: the scheme (HMAC-SHA256 over the signed time and the raw body, the header's form exact, the
  comparison `MessageDigest.isEqual` on equal-length ASCII, both secrets compared while one is
  rotated), that nothing of the body is parsed before it matches, the 64 KiB bound before it, and
  the secret's length and where each server keeps it. A vendor's provider brings its own scheme:
  review it with that provider.
- **Replays and redeliveries.** The window (5 minutes, a server setting from 30 seconds to an hour)
  and the claim of each callback's id for twice the window and a minute, in the server's key/value
  store, which must be one store for the whole cluster; a claim released when its callback ended
  nothing; a duplicate acknowledged with nothing done; and the request's own state, which refuses a
  second ending whatever the claims say. Check the claim's store on a cluster, and the server clocks.
- **A callback signed with the secret.** It ends nothing alone: signed, the file and the evidence
  are fetched from the provider with the server's credential, and the provider must say the
  envelope is signed; declined, the provider must say it is declined. Check that each vendor's API
  can be asked the same two questions.
- **Who sends.** `Write` on the record, as the requester, before anything is sent; the request
  names its record by id and the file by name, nothing else of the record; the signers' addresses
  go to the provider, which mails them. Check: that anyone who may create a request type somewhere
  and write a record may send its files to outside addresses, which is what the step is for; a kit
  should keep its request type where its officers create.
- **Filing as the system.** The signed file and the evidence are written by the system, on the
  record the request named when it was sent, in the file's place only while it is the bytes sent.
  Check the record's types: a record of a type that keeps versions only.
- **What is kept, and by whom.** The table of guards above: each is the listener's, in the
  transaction of the change, and a folder answers for what it holds. Check the administrators'
  exceptions against each server's own practice for deleting records.
- **Credentials.** The API key and the callback secret are read per call from the server's
  properties or environment, under the provider's own names; never logged (`LogTest`), never in an
  answer, an error or a document. Check where each server keeps `nuxeo.conf` and any `conf.d` file
  made from it, readable by the Nuxeo user only, and their rotation.
- **Outbound calls.** The stand-in's address is a server setting: `https`, or `http` only where the
  server allows it; no redirect followed; a 2-second connect timeout, a 20-second deadline for the
  whole call, inside the request's transaction, and at most 24 MiB read. The envelope's id, the one
  value from the service that goes into a later address, is one path segment.
- **The servlet's other filters.** A provider's request carries no `Origin`, which the server's
  CORS and CSRF filter lets through; check the filter's configuration on each server.

## Not done, and not checked

- **On a server:** nothing. That the deployment fragment maps the servlet, that Nuxeo's
  authentication filter is not mapped on its path, that `nuxeo.conf` settings reach
  `Framework.getProperty`, and that Jakarta Servlet 6 is the server's are as the assets add-on's
  share links found on the local 2025.10.18 server, not run here.
- **A real provider,** decision H. Embedded signing in the app, reminders, signing order and
  deadlines, and a signer's own status: the stand-in signs everyone at once.
- **A button.** A request is created from its register's Create menu, with the case picked; a
  record page cannot create a related record yet (the onboarding kit's README, "Where the tools
  fell short").
- **What the listener sees:** changes made through a session, as every client and workflow makes
  them. Java code that writes the repository with the system's rights below the session is that
  code's to answer for.
