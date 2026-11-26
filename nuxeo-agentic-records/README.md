# Nuxeo Agentic Records

The records module's server add-on, its first slice: a **disposition review** on the platform's
retention module, for phase 9 of the business apps
[development plan](../docs/business-apps/development-plan.md) ("A disposition run: the records
due, approved by two people, with a certificate"). A Maven module beside `nuxeo-agentic-core`, with
a Marketplace package of its own, on decision B's recommendation, "one add-on per domain module"
([decision log](../docs/business-apps/decisions.md)). The decision is still open, and the log's
note says what changes if it goes another way.

**Nothing here is installed on any server.** It is proven by its tests, in Nuxeo's own test
framework. Its kit is [`records-demo`](../business-apps/packages/records-demo/README.md).
**Held for its security review**, below.

## The short version

- **On the platform's retention module, `nuxeo-retention`,** which Nuxeo publishes for LTS 2025.
  A record's retention is the module's rules'; a legal hold is the platform's; the add-on decides
  neither. It reads them, and reviews what they leave.
- **A run holds the records due:** records of the module's whose retention has ended, under no
  legal hold, whose rule has no end action of its own, and in no other run awaiting approval, that
  its starter may read. At most 200 by default.
- **Two people approve it,** each with the add-on's `ApproveDisposition` permission, neither of
  them the one who started it. Only then is anything disposed of.
- **Disposed of means deleted, permanently**, in one transaction, after every record is checked
  again: one under a hold since the start, or under retention again, or gone, halts the run, and
  nothing is deleted.
- **A certificate is kept:** a document beside the run, made a record so that its file cannot be
  replaced, whose CSV lists each record disposed of with its identifiers, rule and dates, who
  started and who approved, and when.
- **No Automation operation and no endpoint.** A person files a document, a request, in the
  repository's disposition runs folder, and a synchronous listener on the repository's own events
  checks it and does the work, as the retention module reaches its records through document
  events. Decision 3, operation buttons, is not touched.

## The platform's retention module: used, and how

Found on 26 November 2026, read only:

| Where                        | What it says                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nuxeo's Marketplace          | `nuxeo-retention` is published for LTS 2025 (2025.0.8 to 2025.3.31), Nuxeo supported, with no subscription of its own, for Nuxeo Online Services customers; Apache 2.0. Its newest build needs LTS 2025.18.16 or later                                                                                             |
| The Maven repository         | `org.nuxeo.retention:nuxeo-retention` up to 2025.4.66 is on `packages.nuxeo.com/repository/maven-public`, its jar and package zip downloadable. Its parent, `org.nuxeo:nuxeo-parent:2025.29`, is not public, like every LTS 2025 artifact, so Maven cannot take it as a dependency: the build reads its jar by URL |
| The local server (`mp-list`) | Nuxeo LTS 2025.10.18, without `nuxeo-retention`. The platform's own retention and hold are in its core, `nuxeo-core-2025.10.18`                                                                                                                                                                                    |
| The module's jar, 2025.4.66  | Its model: the `Record` facet, `record:ruleIds`, `record:retainUntil`; a rule's `retention_def:endActions`, `Document.Delete` or `Document.Trash`. At the end of a retention the platform clears it and fires `retentionExpired`; the module saves the day it ended and runs the rule's end actions                |

So the add-on builds on the module, as the platform version this repository targets has it: the
package depends on `nuxeo-retention`, the add-on's types require the module's
(`org.nuxeo.retention.types`), so without it nothing of the add-on starts, and the add-on reads:

- **the record**, the module's: the `Record` facet and a record to the repository (`isRecord`);
- **its retention, from its rule**: ended when the repository no longer holds it under retention
  (`isUnderRetentionOrLegalHold`, `getRetainUntil`) and the module has saved a past day in
  `record:retainUntil`, which it does when the platform ends a retention;
- **its rule**, the first of `record:ruleIds`, read with the add-on's session, for its title, and
  for its end actions: a rule with one disposes of its records itself when their retention ends, and
  its records are never a run's;
- **its hold**, the platform's (`hasLegalHold`), which the module's `Document.Hold` sets.

It writes nothing of the module's, and never a record but to delete it.

**The tests read the module's own model.** The pom fetches `nuxeo-retention-2025.4.66.jar` from
Nuxeo's repository, holds it to its SHA-256, and unpacks its schemas, types and permissions into
the tests; `RetentionModelTest` holds every name the add-on reads to the module's files, so a
version of the module that renames one fails the build. The module's classes are never loaded:
they need LTS 2025's platform, and the tests run on 11.5's, the last on the public repository.

## Trash or delete: delete

A run's records are **deleted, permanently**, with `CoreSession.removeDocument`, by the add-on's
session once two people have approved it. Why:

- **The retention module leaves the choice to the review.** A rule's end action is
  `Document.Delete` or `Document.Trash`, and a rule with one disposes of its records itself, with no
  review. A record reaches a run only when its rule has none, so the method is the review's to say.
- **A certificate attests destruction.** A trashed record still exists, can be restored, and is
  readable to whoever may read the trash: a certificate listing it as disposed of would not be true.
- **Deletion is what the platform guards.** The repository refuses to delete a document under
  retention or a legal hold, whoever asks, the add-on's session included (seen in the tests:
  "Cannot remove ..., it is under retention / hold"). Trash is a property, which that guard does not
  cover. So a hold the add-on's own check missed still stops the deletion.

It cannot be undone: that is why it takes two people other than the starter, a check of every
record at the moment of disposal, one transaction, and a certificate. A record's file is removed by
the platform's blob garbage collection, as after any deletion; its versions as the platform's
version removal policy says.

## How a person reaches it

A **listener**, not the route model: `DispositionListener`, synchronous, on the repository's
document events. A workflow's task would need its node's chain to call an operation, which the app
could then reach too; a document event needs none.

A person files a **`DispositionRequest`** in the repository's **`DispositionRuns`** folder, over the
REST API (`POST /api/v1/path/<the folder>`), with `dreq:action`:

| Action    | Also       | Who                                                                 | What it does                                                                                        |
| --------- | ---------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `start`   |            | `StartDisposition` on the folder                                    | A new `DispositionRun` holding the records due that the person may read; refused, 409, when none is |
| `approve` | `dreq:run` | `ApproveDisposition`, and not the run's starter                     | An approval; the second, by another person, disposes of the run, or halts it                        |
| `reject`  | `dreq:run` | `ApproveDisposition`, or `StartDisposition` (the starter withdraws) | The run is closed, its records kept, and free for another run                                       |

`dreq:comment` is the filer's too, up to 2000 characters. Everything else on the request (who,
when, the run's number, the outcome) is written by the server, over whatever the filer sent. The
answer is the request, with its outcome: `started`, `approved`, `disposed`, `halted` or `rejected`.

Runs and certificates are written by the add-on alone. A run's states: `pending`, then `disposed`,
`halted` or `rejected`.

## The certificate

A `DispositionCertificate`, `certificate-<run number>`, beside the run, written in the transaction
that deletes the records, then made a record, so that the repository keeps its file as written:

- **its properties** (`dcert:`): the run and its number, who started it and when, the approvals,
  when the records were disposed of and how (`deleted`), their count, each record (its id, path,
  title, type, rule id and title, and the day its retention ended), and the SHA-256 of the CSV;
- **its file**, `disposition-certificate-<n>.csv`: one row per record, each row whole on its own
  (the run's number, starter and start, both approvers and when, when disposed of, how, and the
  record's identifiers, rule and retention end), so that a records specialist can sort and filter it
  in a spreadsheet. RFC 4180, UTF-8 with a byte order mark, times in UTC. A field that a spreadsheet
  would read as a formula (`=`, `+`, `-`, `@`, a tab, a carriage return) starts with `'`.

The run keeps the certificate's id and the CSV's SHA-256 too.

## Security notes, for the review

- **Who may do what is the folder's ACL.** `StartDisposition` and `ApproveDisposition` each include
  Read and AddChildren. Nuxeo counts `Everything` as holding both, and administrators as holding
  all: the folder **must block every permission it would inherit**, and the add-on refuses every
  request in one that does not, 409, so that an inherited `Everything` grants neither.
- **One folder per repository,** made by an administrator alone, so that no one makes a folder of
  their own where they hold `Everything`, and no run misses another's records.
- **The two-person rule** is checked on the server, against the run as the last request left it:
  the starter may not approve, nor anyone twice, with names compared without their case, as
  `LayerService` compares an approver with a draft's makers. The system and anonymous users file
  nothing.
- **Disposal is the add-on's session's,** once the two approvals are in: an approver needs no Remove
  permission on the records, so `ApproveDisposition` is a strong permission, for the few people a
  records schedule names. A run holds only records its starter may read, so a run shows no one a
  record its starter could not see; the people who may read the folder see the run's list.
- **One at a time, each in a transaction of its own.** Every request is taken inside one lock, the
  server's and the cluster's (`ClusterService.runAtomically`), as `LayerService` makes its changes,
  and runs in a transaction of its own, committed before the lock is given back. Two approvals at
  once are taken one after the other: one person's second is refused, and a run is disposed of once.
  A request whose transaction fails writes nothing, and its records are back. The request document
  is written afterwards, by the person's own transaction: should that one fail after the request's
  own committed, the run keeps what was done, and the request document is missing. The run is the
  record of what was decided.
- **Everything else on the add-on's documents is refused**, administrators included: a run or a
  certificate made by anyone but the add-on, a change to a property of the add-on's schemas or a
  certificate's file, a move, copy, check-in, restore or trash. A deletion is an administrator's
  alone, and is logged. Hiding a run in the app is not the control: this is.
- **The logs** name who did what, and never a record's title. Names are written with control
  characters replaced, so no one writes a line of their own into the log.
- **What it does not close:**
  - a hold put on in the instant of a disposal, by a transaction that has not committed when the
    disposal reads the record, is not seen by the add-on; the repository's own check at deletion has
    the same window;
  - a request filed by a script that has itself written a record in the same transaction could wait
    on its own lock, until the database's lock timeout;
  - the add-on is a control only as far as the server's administrators: one of them may delete a run
    or a certificate, or uninstall the add-on;
  - the run's records list is a copy, as the starter could read the records: if a record's title is
    itself sensitive, the folder's readers see it.

## What is not built

- **Physical records,** with locations, barcodes and chain of custody.
- **The audit export** a records specialist accepts, phase 9's "Done when". The certificate's CSV is
  its first piece, for that specialist's review, not the export.
- **Access logging.**
- **Tenancy**, decision G, which the plan says is designed with the platform team.
- **A button in the app.** Decision 3 is open; a run is started and decided over the REST API.
- **A disposition schedule.** A run is started by a person; nothing starts one on a timer.

## Tests

In Nuxeo's own test framework (`FeaturesRunner`, `CoreFeature`): a real repository with the
platform's retention, hold, security and transactions, the add-on's bundle as it ships, and the
retention module's model from its jar. Nuxeo's 11.5 test framework is the last on the public
repository; on Java 21 it needs a newer ASM and Chronicle Queue, which the pom pins for the tests
alone, and some JDK packages opened.

| Test                       | What it proves                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DispositionRunTest`       | Which records a run holds and which it does not; two approvals dispose and certify; a rejection frees the records; the platform's own expiry makes a record due              |
| `DispositionRefusalTest`   | Every refusal: no permission to start or approve, the starter's approval, a second by the same person, a hold, a retention or a retention end since the start, a record gone |
| `DispositionAtomicityTest` | A failure partway through disposes of nothing; two approvals, two second approvals, one person's two, and two starts, at once                                                |
| `DispositionGuardTest`     | The add-on's documents are its own; one folder per repository, an administrator's; a folder that inherits takes no request                                                   |
| `CertificateCsvTest`       | The CSV's rows, quoting and formula guard                                                                                                                                    |
| `RetentionModelTest`       | What the add-on reads of the module, held to the module's own files                                                                                                          |
| `BundleTest`               | The bundle's version is the package's; it contributes no operation and no endpoint; the package depends on the module                                                        |

**Each refusal was seen failing without its check**: every check above was removed in turn, and its
test failed (26 November 2026): the start and approve permissions, the self-approval and its case,
the second approval by one person, the re-check at disposal and the hold check itself, the record
in one run at a time, the lock, the one transaction, the folder's block, the add-on's properties,
the administrator's deletion, the server's runs and certificates, the one folder, the rule's end
action, the retention end, the retention, and the CSV's formula guard. A wrong SHA-256 for the
module's jar fails the build.

```bash
mvn verify -pl nuxeo-agentic-records -am
```

## What is in it

| File                                               | What it is                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/main/java/org/nuxeo/agentic/records/`         | The listener, the requests and the disposal, the records due, the certificate's CSV        |
| `src/main/resources/OSGI-INF/records-types.xml`    | The four types and their schemas, after the retention module's                             |
| `src/main/resources/OSGI-INF/records-security.xml` | `StartDisposition` and `ApproveDisposition`                                                |
| `src/main/resources/OSGI-INF/records-listener.xml` | The listener                                                                               |
| `src/main/package/`, `src/main/assemble/`          | The Marketplace package, `nuxeo-agentic-records` 0.1.0, which depends on `nuxeo-retention` |
| `src/test/`                                        | The tests, the module's types as the tests register them, and two test-only listeners      |

`nuxeo.agentic.records.disposition.maxRecords`, in `nuxeo.conf`, sets the most records a run holds,
1 to 1000, 200 by default, so that a disposal is one transaction of a bounded size.
