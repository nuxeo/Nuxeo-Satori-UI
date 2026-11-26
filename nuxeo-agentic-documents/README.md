# nuxeo-agentic-documents: numbering, revisions and supersession, on the server

The document control module's server add-on ([development plan](../docs/business-apps/development-plan.md),
phase 8, "The document control add-on"), version 0.1.0: its first slice, numbering, revisions and
supersession. A Maven module beside `nuxeo-agentic-core`, with its own Marketplace package,
`nuxeo-agentic-documents`. The [controlled documents kit](../business-apps/packages/controlled-documents-demo/README.md)
is built on it.

**Built against an open decision.** Decision B, the packaging of the server tier, is open; this
follows its recommendation, "`nuxeo-agentic-core` for the runtime essentials; one add-on per domain
module" ([decisions.md](../docs/business-apps/decisions.md), and its note). Nothing of it went into
`nuxeo-agentic-core`.

**Needs its security review before anyone relies on it** (below, "For the security review"). It
is not installed anywhere: it was built and tested on a Nuxeo runtime in the build's JVM, and
compiled against the local server's own jars, read only.

## The short version

- **A controlled document is any document whose type carries the `ControlledDocument` facet.** The
  facet brings the `controlled_document` schema, prefix `docctl`: the number series, the document
  number, the revision, the status (`current` or `superseded`), and the ids of the revision it
  supersedes and of the one superseding it.
- **Numbering.** A new controlled document names its series in `docctl:series`, one a package
  registers. On creation the server gives it the series' next number, from Nuxeo's own sequencer,
  `DWG-00042`, the series' first revision, and `current`. A number is unique in its series and
  never given twice; a creation that rolls back leaves a gap, which the sequencer documents.
- **A revision supersedes the one before it.** A new document that names a current revision in
  `docctl:supersedes` is that revision's next: it takes its series and number and the next
  revision, `B` after `A`, and, in the same transaction, the old one is marked `superseded` and
  linked to it by `docctl:supersededBy`. Refused, with nothing written, when the user may not write
  the old one, or it is not current.
- **The six properties are the server's.** Whatever a creator writes in them is replaced; any later
  change to them is refused, an administrator's included; a controlled document, or a folder
  holding one, is not copied; and a version is not restored over one when that would change them.
- **It numbers nothing on its own.** A package registers a series and gives a type the facet; the
  controlled documents kit registers `DWG` and `SPEC` for its `EngineeringDocument`.

## The route: a listener, on creation

Supersession is reached from a document's creation, through a synchronous listener,
`ControlledDocumentListener`, with no Automation operation and no button: operation buttons wait on
decision 3. Why this route:

- **Creation, not a later property change.** A revision's number and revision are given before the
  document exists for anyone, so no one ever sees a draft with a number of its own that a later
  supersession would have to change or give up. Naming the predecessor afterwards would mean either
  renumbering a document people may already have cited, or spending a number and leaving a gap.
  So `docctl:supersedes` is written once, at creation, and refused afterwards like the others.
- **A synchronous listener, in the caller's transaction.** `aboutToCreate` gives the number or the
  revision before the document is written; `documentCreated`, once it has its id, marks the old
  one. Both run as the user, in the transaction of the creation, so the old one's write is held to
  the user's own permissions by the platform, and a failure anywhere rolls back both: the new
  revision is never left without its predecessor marked, nor the old one marked for a revision that
  does not exist. Every refusal marks the transaction for rollback before it leaves, so a caller
  that catches it cannot commit half (`SupersessionTest`).
- **The platform's own mechanisms otherwise.** The sequencer is the platform's `UIDSequencer`, the
  one Nuxeo's own UID generators use; the facet and schema are ordinary contributions; a refusal is
  the platform's `NuxeoException` with a status the REST API returns, 400, 403 or 409.
- **Every client reaches it.** The REST API's document endpoints, `Document.Create` and the other
  Automation operations that create or save, the Web UI and Satori's own forms all go through
  `CoreSession.createDocument` and `saveDocument`, so the listener sees them all. Nothing in it
  depends on which client sent the change.

## Numbering

| Step                                                 | What happens                                                                                                                                                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new controlled document, `docctl:supersedes` empty | Its `docctl:series` must be a registered series, or the creation is refused, 400. The series' next value from the sequencer is written as its number; its revision is the series' first; its status `current`        |
| The number                                           | The series' id, a hyphen, and the value with leading zeros to the series' `digits`: `DWG-00042`. A value wider than `digits` is written whole, `DWG-100000`, never cut                                               |
| The sequencer                                        | The platform's default `UIDSequencer`, or the one `nuxeo.agentic.documents.sequencer` names. On Nuxeo LTS 2025 the default is `KeyValueStoreUIDSequencer`, counting in the server's key/value store (SQL or MongoDB) |
| Its key                                              | `org.nuxeo.agentic.documents.series.<id>`: no other key the platform counts with starts so                                                                                                                           |

- **Unique in its series, and two series never collide.** The sequencer gives each value once, for
  the whole cluster: its key/value store increments atomically, on a connection of its own. The
  digits hold no hyphen, so the last hyphen of a number parts the series' id from its digits, and
  no two series can write the same number (`NumberSeriesTest`).
- **Never reused, so a rollback leaves a gap.** The key/value store does not take part in the
  caller's transaction: a value taken by a creation that rolls back is not given back, and no
  number is ever given twice. That is the gap the sequencer documents, and the concurrency test
  measures it exactly (below).
- **Under contention, asked again.** The SQL key/value store increments with a compare-and-set
  where its database has no atomic increment, H2 among them, and gives up after five tries with a
  `ConcurrentUpdateException`. A try that gives up has taken no value, so the add-on asks again, up
  to 20 times, after a short random wait. The concurrency test found this: 16 threads on H2 failed a
  creation before the retry was added.

## Revisions and supersession

A new controlled document that names, in `docctl:supersedes`, the id of the revision it supersedes:

1. **`aboutToCreate`:** the id must be a document's id; the user's session must read it, or the
   creation is refused, 403, as the platform answers a read of it. It must be a live controlled document, not a version or a proxy, of the
   new one's type, not in the trash, `current` with no `docctl:supersededBy`, with a number. **The
   user must have `Write` on it**, or the creation is refused, 403, before anything is written. Its
   series must still be registered, and its revision one the series writes. The new document is
   given its predecessor's series and number, the next revision (`A` to `B` ... `Z` to `AA`, or
   `1` to `2`), and `current`.
2. **`documentCreated`:** the predecessor is read and checked again, then **claimed** (below), then
   written as the user: `docctl:status` `superseded`, `docctl:supersededBy` the new revision's id.
   The platform checks the user's `WriteProperties` on it again as it saves.
3. **Either both are written, or neither.** A refusal at either step, a failure of the old one's
   write, or any later failure in the transaction rolls the transaction back
   (`SupersessionTest.whenMarkingTheOldRevisionFailsTheNewOneIsNotCreatedEither`, and the two
   after it).

**Two revisions of one at once.** The repository does not refuse two transactions writing the same
document at the same time: on VCS (H2 here, and PostgreSQL) the last write wins. Without more, two
people creating a revision B of A at once would both find A current, and both mark it. The
concurrency test showed it: 16 threads, 6 revisions created over one A. So each supersession first
**claims** its predecessor in the server's key/value store, store `agentic-documents`, key
`supersedes.<id>`, with a compare-and-set from nothing to the new revision's id: atomic for the
whole cluster, and one transaction's alone. Another transaction that finds the claim taken is
refused, 409, and rolls back.

- **A claim whose transaction does not commit is released at once,** by a synchronization on the
  transaction. `TransactionHelper.registerSynchronization` takes a `javax.transaction.Synchronization`
  on 11.5, which the bundle compiles against, and a `jakarta.transaction.Synchronization` on LTS
  2025, which it runs on; the add-on looks the method up by reflection, jakarta first, and checked
  that it is found on the local server's own jars.
- **No release, no claim.** The release is registered first, and the claim taken after. Where the
  release cannot be registered, as in a transaction already marked for rollback, which server code
  that carries on past a failure can be in, the supersession is refused, 409, and nothing is
  claimed: a claim no rollback releases would block the revision until it expired
  (`SupersessionTest.aTransactionMarkedForRollbackClaimsNothing`).
- **A committed claim is kept for a day,** `nuxeo.agentic.documents.claim.ttl`, in seconds. It must
  outlast twice the longest transaction the server runs, so that a transaction that read the old
  revision as current before the claim's committed has ended before the claim expires; after that,
  the old revision's own `superseded` refuses. A server stopped mid-transaction leaves its claim
  until it expires: that revision cannot be superseded until then.

## What it refuses

| Change                                                                               | Answer | Why                                               |
| ------------------------------------------------------------------------------------ | ------ | ------------------------------------------------- |
| A new document with no series, or one not registered                                 | 400    | It cannot be numbered                             |
| `docctl:supersedes` not an id, of no document, or of one not a live controlled one   | 400    | There is nothing to supersede                     |
| Superseding a document the user may not read                                         | 403    | As the platform answers a read of it              |
| Superseding a revision of another type                                               | 400    | A revision is of its predecessor's type           |
| Superseding a revision in the trash, superseded, being superseded, or with no number | 409    | Only the current revision is superseded, once     |
| Superseding a revision the user may not write                                        | 403    | It could not be marked superseded                 |
| Any change to a `docctl:` property on a save, by anyone, or through a live proxy     | 400    | They are the server's                             |
| The facet added to a document, at creation or after, or removed                      | 400    | A type decides what is controlled                 |
| Copying a controlled document, or a folder holding one, readable by the user or not  | 400    | The copy would carry the number                   |
| Restoring a version whose `docctl:` properties differ from the live document's       | 409    | A superseded revision would be made current again |

Whatever the creator writes in the six properties of a new document is replaced, not refused,
blanks and padding included: a REST client may send the whole document back. On a save, a value is
compared as stored, so `" current "` for `current` is a change, and refused: read trimmed, it
would still pass for current to the add-on and to no query. Writing a property's own value back,
or an empty text for none, is no change.

**Each refusal is told to the user, not logged as an error.** It is a `RecoverableClientException`
with its status, which the event service logs at `INFO`, where it logs any other exception a
synchronous listener throws at `ERROR`, with its stack: a user who may create or write could
otherwise fill the server's log (`RefusalLogTest`, which also shows an unforeseen failure still
logged at `ERROR`). The add-on logs each refusal at `INFO` too, with the event, the document, its
type, the user and the reason. A refusal message names the creator's series text only when it has a
series id's form, and an id only once it is checked to be one.

### Administrators

**Not exempt** from any of the refusals above: no check reads the user's groups, and
`GuardTest.noSaveChangesAControlledPropertyNotEvenAnAdministrators` saves as one. Where the
platform makes an exemption unavoidable:

- **An administrator controls the server's configuration:** they can disable the listener in the
  administration screens, install a package that removes a series, reset a sequence, or delete a
  claim, which no add-on can refuse.
- **`CoreSession.importDocuments`, administrators only,** writes documents as they are given, with
  no `aboutToCreate`: an import carries its numbers unchecked.
- **Server code with an unrestricted session** is not held to the user's permissions, so a chain
  run unrestricted may supersede what its caller could not write.

## The series

Contributed to `org.nuxeo.agentic.documents`, point `series`, by a component that requires
`org.nuxeo.agentic.documents`:

```xml
<series id="DWG" digits="5" revisions="letters" />
<series id="SPEC" digits="4" revisions="numbers" />
```

- `id`: capitals and digits, in parts joined by single hyphens, 32 characters at most.
- `digits`: 1 to 12, the least a number's value is written with; 5 when not given.
- `revisions`: `letters` (A, B ... Z, AA, AB ...), the default, or `numbers` (1, 2, 3 ...).
- A series with a mistake is left out, logged as an error, so a document in it is refused. A later
  series with the same id replaces it whole, a broken one leaves none in force, and
  `enabled="false"` removes it (`SeriesRegistryTest`).

## What it does not cover yet

- **The rest of the document control add-on** the plan lists: transmittals, review cycles with
  comment resolution, and export-control marks enforced when sharing. And outside users, who will
  receive transmittals and comment in the portal, wait on decision C.
- **A default series per type.** The creator names the series; a create form must offer it.
- **Deleting.** A revision deleted for good leaves its neighbours' links naming an id that is gone,
  which the record page shows as "Unavailable". Trashing is allowed, and a trashed revision is not
  superseded.
- **Who may start a series' numbering.** Anyone who may create a document of a controlled type
  takes the next number of any registered series: the series is not restricted by type or group.
- **Versions keep the fields they were made with,** as every Nuxeo version does: a version of a
  revision taken before it was superseded says `current`. The live document is the register.

## Checked against the server's own jars

The Nuxeo artifacts Maven resolves are 11.5's, as for the other add-ons: the 2025 ones are not on
the public repository. So, read only, from the local Docker Nuxeo LTS 2025.10.18 (`docker cp` out of
`nxserver/bundles`, `nxserver/lib` and `lib`, then `javap`; nothing installed, restarted or
written):

- **The bundle's sources compile against the server's own 2025.10.18 jars** in place of the 11.5
  ones: `nuxeo-core-api`, `-core`, `-core-event`, `-core-schema`, `-runtime`, `-runtime-jtajca`,
  `-runtime-kv`, `-common`, `log4j-api` and `jakarta.transaction-api`.
- **The sequencer:** `nxserver/config/uidsequencer-config.xml` makes `KeyValueStoreUIDSequencer`
  the `default` sequencer, counting in the `sequence` key/value store, which falls back to the
  `default` one, `SQLKeyValueStore` on the repository's database (`sql-kvstore-config.xml`). Its
  `addAndGet` takes a connection of its own, outside the caller's transaction, and retries five
  times before a `ConcurrentUpdateException`. `UIDGeneratorService.getSequencer()` and
  `UIDSequencer.getNextLong(String)` are in both versions.
- **The events and what they carry:** `AbstractSession` fires `aboutToCreate` after the
  `AddChildren` check and before the document is written, and `documentCreated` after, with a
  second write of the model; `beforeDocumentModification` with `previousDocumentModel`;
  `aboutToCopy` for `copy` and `copyProxyAsDocument`, on the source; `beforeRestoringDocument`
  with `RESTORED_VERSION_UUID`, and no `beforeDocumentModification` for a restore. `documentCreated`
  also fires for a version and a proxy, which the listener leaves alone.
- **How a synchronous listener's exception reaches the caller:** `EventServiceImpl.fireEvent`
  rethrows one when the transaction is marked for rollback or the event bubbles, and logs and
  swallows it otherwise; the listener does both.
- **The synchronization:** `TransactionHelper.registerSynchronization(jakarta.transaction.Synchronization)`
  is found by the add-on's lookup on those jars, and `jakarta.transaction.Status.STATUS_COMMITTED`
  is 3.

## Building and testing it

From the repository's root, with JDK 21 and Maven:

```bash
mvn -pl nuxeo-agentic-documents -am verify
```

It runs the module's 45 tests and writes the bundle and the Marketplace package,
`nuxeo-agentic-documents/target/nuxeo-agentic-documents-0.1.0.zip`. `build-marketplace.yml` builds
and tests it on every pull request it runs for, without uploading or publishing it.

**On the Nuxeo test framework.** The tests are `FeaturesRunner` tests on `CoreFeature`: a Nuxeo
runtime, a VCS repository on H2, as the local server's, JTA transactions, and the SQL key/value
store and `KeyValueStoreUIDSequencer` configured as the local server configures them
(`src/test/resources/OSGI-INF/test-documents-contrib.xml`). Three things in `pom.xml` make 11.5's
test framework run on Java 21, for the tests only, none in the bundle: ASM 9.7, which reads Java 21
class files where 11.5's 9.0 does not; the JDK packages opened to Nuxeo Stream; and Chronicle Queue
2.25ea, where 11.5's 2.20 looks for a JDK method Java 21 removed. Chronicle publishes its open-source
builds as `ea`, and the test runtime starts it whether a test uses streams or not. A fourth,
`log4j-jcl`, takes 11.5's event service's Commons Logging to Log4j 2, where `RefusalLogTest` reads
it.

| Test                 | What it holds                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NumberingTest`      | A first revision numbered from its series, each series counting alone, the creator's own values replaced, blanks and padding included, no series or an unknown one refused, the facet refused when added                                                                                                                                                                                                                  |
| `SupersessionTest`   | The number and next revision taken, the old one superseded both ways; refused for a superseded, trashed, other-typed, missing or version predecessor; refused without write, and without read, with nothing written; atomic when the old one's write fails, when a caller catches the refusal, and when the caller's transaction fails later; the claim released each time; no claim in a transaction marked for rollback |
| `ConcurrencyTest`    | Many threads at once, each creation in its own transaction (below); and 16 revisions of one at once, of which one wins and every other is refused as a conflict                                                                                                                                                                                                                                                           |
| `GuardTest`          | No save changes a `docctl:` property, an administrator's included, padded with spaces included, nor marks a revision superseded by hand, nor writes through a live proxy; the facet not added; no copy; no restore that would change them                                                                                                                                                                                 |
| `RefusalLogTest`     | A refusal not logged by the event service as an error; an unforeseen failure still logged as one                                                                                                                                                                                                                                                                                                                          |
| `NumberSeriesTest`   | Numbers, series ids, digits, revisions, document ids                                                                                                                                                                                                                                                                                                                                                                      |
| `SeriesRegistryTest` | Series replaced, broken and removed                                                                                                                                                                                                                                                                                                                                                                                       |
| `BundleTest`         | The manifest's components, the service, the facet and the schema the runtime registers, and the package's version                                                                                                                                                                                                                                                                                                         |

**The concurrency test:** 16 threads, each creating 25 documents in one series, each creation in a
transaction of its own, started together; every seventh creation rolls its transaction back after
its number was taken. It asserts that every committed number is held by exactly one document; that
no rolled-back number is stored; that the numbers given, committed or rolled back, are exactly 1 to
400, so the only gaps are the rolled-back ones and none is reused; and that the next number is 401.
It passes, on H2 with the SQL key/value store, in about a second, and passed six runs in a row;
with the sequencer asked once instead of up to 20 times, it failed six runs of six, each on the
store's `ConcurrentUpdateException`. Its second case, 16 threads superseding one revision at once,
asserts one winner, the old revision superseded by it alone, no other revision naming it, and each
of the 15 others refused as a conflict, 409, by the claim or by finding the old one superseded: none
by anything else, such as a lock timeout.

**Every guard was seen failing.** Each of 29 breakages, one at a time, turned its tests red, and the
build unbroken was green. The four the independent review's fixes added: values compared trimmed
(a padded `" current "` let through); a blank `docctl:supersedes` kept on a first revision; a claim
taken where no release could be registered (a transaction marked for rollback then blocked the next
supersession); and a refusal thrown as a plain `NuxeoException` (the event service logged it as an
error). The first 25: numbers from a constant; the creator's status kept; the write check
removed (the platform's own `WriteProperties` refusal still came, without the add-on's message);
the rollback mark removed (a caller that caught the refusal committed the new revision alone); no
claim (16 of 16 revisions created over one); a claim not released, or released only on commit; the
guard off; the supersession's token not checked; a copy allowed; a folder's contents looked for as
the user; any restore allowed; the facet allowed on a saved document, or on a new one; another type,
a trashed, a version or a superseded predecessor allowed (the last still refused, by the claim
committed a moment before); the creator's text written back; any text a series id; a number without
its hyphen; the letters miscounted; the manifest's version moved; the listener not told of
creations; a broken series leaving an earlier one in force.

**What the tests cannot reach:** a server whose key/value store is MongoDB, or PostgreSQL, rather
than H2; the jakarta half of the synchronization lookup, which only the server has; and REST
clients: the listener sees `CoreSession`, which every endpoint goes through, but no HTTP request is
made here.

## Installing it on a local Nuxeo

**Not run.** The orchestrator installs. The local Nuxeo is the Docker container `nuxeo`, on port
8080; `nuxeoctl mp-install` refuses while the server runs, so a one-off script installs it when
the container next starts, as the assets add-on's README does. Install it with the controlled
documents kit, which depends on it, in one restart.

```bash
mvn -pl nuxeo-agentic-documents -am package
npm run app-package -- business-apps/packages/controlled-documents-demo --platform 0.2.0
docker cp nuxeo-agentic-documents/target/nuxeo-agentic-documents-0.1.0.zip nuxeo:/tmp/
docker cp business-apps/packages/controlled-documents-demo/dist/controlled-documents-demo-0.1.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/nuxeo-agentic-documents-0.1.0.zip /tmp/controlled-documents-demo-0.1.0.zip --accept=true > /var/log/nuxeo/documents-install.log 2>&1 || echo "documents: install failed, see /var/log/nuxeo/documents-install.log"' 'rm -f "$0"' > /tmp/zz-documents-install.sh && chmod 755 /tmp/zz-documents-install.sh
docker cp /tmp/zz-documents-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

Then, once `http://localhost:8080/nuxeo/runningstatus` answers 200: the install log lists both
packages; the server log's `Component Loading Status` names `org.nuxeo.agentic.documents`,
`org.nuxeo.agentic.documents.schema`, `org.nuxeo.agentic.documents.listener` and
`nuxeo.config.controlled-documents-demo.series`, with nothing pending; it has no `Controlled
documents:` error; and the kit's seed runs (its README). To remove both:
`nuxeoctl mp-remove controlled-documents-demo nuxeo-agentic-documents --accept=true`, the kit first.
Documents of the kit's type must be deleted first: one whose type is gone cannot be read.

## For the security review

The plan requires one before this is relied on. It should check:

1. **Every path that writes a document,** listed from the server's bundles: that each goes through
   `CoreSession.createDocument` or `saveDocument`, so the listener sees it, and which do not, as
   `importDocuments` and unrestricted server code do. Bulk actions that set properties among them.
2. **The refusals' order and messages:** that a refusal says nothing a user may not already know.
   A user learns that an id they may not read exists (403 rather than 400), as the platform's own
   REST API tells them.
3. **The claim:** its store, its key, its expiry against the longest transaction the server runs,
   and its release through the reflected synchronization on the server's own transaction manager.
   What a stopped server's leftover claim does, and whether an administrator needs a way to clear
   one.
4. **The sequencer:** that the server's key/value store is shared by every node of a cluster, so a
   number is unique across them, and what a reset of a sequence, an administrator's, would do.
5. **The token:** that the supersession's own write is told apart from a client's by the identity
   of an object only the add-on holds, in the document's context data, and that nothing a client
   sends can be that object.
6. **Who may number and supersede:** any user who may create a document of a controlled type, in
   any registered series; and any user with `Write` on a current revision, who may supersede it.
   Whether series must be restricted to types or groups.
7. **Copies and restores:** that refusing every copy of a controlled document, and of a folder
   holding one, is right; the privileged query that looks below a folder, by `ecm:ancestorId`, with
   the folder's id written into it after a check of its form.
8. **The cost:** one listener on five events for every document, which reads only a facet for a
   document that is not controlled, and one query per copy of a folder.
