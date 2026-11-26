# Nuxeo Agentic Records

The records module's server add-on, its first two slices: a **disposition review** on the
platform's retention module, and the **audit export** and **access logging** a records specialist
reviews, for phase 9 of the business apps
[development plan](../docs/business-apps/development-plan.md) ("A disposition run: the records
due, approved by two people, with a certificate"; "audit export; access logging"; "a records
specialist accepts the disposition audit export"). A Maven module beside `nuxeo-agentic-core`, with
a Marketplace package of its own, on decision B's recommendation, "one add-on per domain module"
([decision log](../docs/business-apps/decisions.md)). The decision is still open, and the log's
note says what changes if it goes another way.

**Nothing here is installed on any server.** It is proven by its tests, in Nuxeo's own test
framework. Its kit is [`records-demo`](../business-apps/packages/records-demo/README.md).
**Its security review is deferred until the app is finished;** the security notes below are what
that review will read.

## The short version

- **On the platform's retention module, `nuxeo-retention`,** which Nuxeo publishes for LTS 2025.
  A record's retention is the module's rules'; a legal hold is the platform's; the add-on decides
  neither. It reads them, and reviews what they leave.
- **A run holds the records due:** records of the module's whose retention has ended, under no
  legal hold, whose rule has no end action of its own, and in no other run awaiting approval, that
  its starter may read; documents, not folders nor documents holding others, and none of the
  add-on's own. At most 200 by default. A record in the trash is reviewed as any other: the trash is not a disposition.
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
- **An audit export, for a records specialist:** what the platform's audit holds of the documents
  under a folder over a period, retention rules applied, holds placed and lifted, disposition runs
  with their approvals and certificates, reads, deletions and every other change, as a CSV and a
  JSON file written on the server, a page of the audit at a time, each with its SHA-256, and kept
  as a record. Filed like a request, by someone with the add-on's `ExportRecordsAudit`, and refused
  to anyone else ([below](#the-audit-export)).
- **Access logging:** every file of a record downloaded or shown is in the platform's audit already,
  its `download` event; the add-on adds a record's views, a record under retention or a legal hold
  sent to a person as a document of its own, at about 0.1 ms a read, and each disposition run's
  decisions on each of its records ([below](#access-logging)).

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

## The audit export

### Filed, then written

A person with `ExportRecordsAudit` on the repository's disposition runs folder files a
`RecordsAuditExport` there, over the REST API (`POST /api/v1/path/<the folder>`), naming:

| Property       | What it is                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `rexp:path`    | The folder it covers, by its path or its id, which the person may read; not a document, nor the root                     |
| `rexp:from`    | The period's start: every entry whose event happened then or after                                                       |
| `rexp:to`      | The period's end, after `rexp:from`: every entry whose event happened before it; at the latest, when the export is filed |
| `rexp:comment` | Optional, up to 2000 characters                                                                                          |

The listener checks it in the person's transaction, and refuses it, with nothing written: 403
`permission` without `ExportRecordsAudit`; 404 `no-folder` for a folder that does not exist or that
the person may not read, named the same way so that the answer says nothing of it; 400 for a period
or a scope it cannot take; 409 for a folder that inherits, as for any request. Everything else on
the export is the server's, over whatever the filer sent: who filed it and when (`rexp:by`,
`rexp:at`), its title, the folder's path as the repository has it, and its state, `pending`. **A
period that ends after the export is filed ends when it is filed:** what is to come is not in the
audit yet, so `rexp:to` is written as the filing time, and the export says the period it covers.

Once the person's transaction has committed, the add-on writes the export **in the background**, as
the filer, so that a long period never holds anyone's request. It first waits until 30 seconds have
passed since the period's end, since the platform writes its entries a moment after their events
and the add-on writes its own in the background (`nuxeo.agentic.records.audit.export.settleSeconds`,
0 to 600; `AuditExportGenerationTest` holds that an entry written after the filing is in it). Then
it reads the audit 500 entries at a time, by entry id, each page after the last, and writes each
entry to two files on disk as it goes, so that **no period is held in memory**, whatever its length;
then it keeps both files on the export, with their SHA-256 and their counts, makes the export a
record, and writes the export's own entry to the audit, `recordsAuditExported`. Its state is then
`done`. An export that cannot be written keeps no file and is `failed`, with one sentence, and the
server's log says why; it is filed again, as is one whose filer the background work cannot tell.
The writing has a transaction of its own, of up to four hours. An export still `pending` several
minutes after its period's end was not written, as when the server stopped meanwhile: it is filed
again.

### What it holds

**Every entry of the platform's audit whose document was the folder, or under it, when the entry
was recorded, and whose event happened in the period,** in the audit's order, its entry id: the
order the audit wrote them. Nothing is left out by kind, so that a specialist sees everything that
happened to the folder's records, and each row says what kind it is.

- **An entry about a document the filer may not read is left out, and counted** (`rexp:omittedCount`,
  and the JSON's `summary.omitted`), so that the export says it is not complete for them.
- **An entry about a document that no longer exists is kept,** since the audit is then all that
  remains of it, as for a record disposed of, when the filer may read the nearest folder above it
  that still exists; `record_exists` says `no`.
- **By path, as the audit recorded it:** a record moved out of the folder appears until its move, and
  one moved in from its move. A sibling whose name only starts like the folder's, `/records-old` for
  `/records`, is not under it.

### The columns

The CSV and the JSON file have the same rows and the same columns, one row per audit entry, each
row whole on its own, so that a row sorted or filtered away from the others still says what
happened, to which record, by whom and when.

| Column               | What it says                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `entry_id`           | The audit's own id for the entry: the order the audit wrote it, and how to find it again                                                               |
| `event_date`         | When it happened, a UTC instant                                                                                                                        |
| `logged_date`        | When the audit recorded it: a moment after `event_date`                                                                                                |
| `kind`               | `retention`, `hold`, `disposition`, `deletion`, `read`, `change`, `export` or `other`, below                                                           |
| `event`              | The audit's event ID, such as `afterSetLegalHold`                                                                                                      |
| `what`               | What it means, in a few words, such as "Legal hold placed"; an event the add-on does not know reads as its ID                                          |
| `user`               | Who: the person, or, for what the add-on's session did, `system`, such as the deletion of a record disposed of                                         |
| `record_uid`         | The document's id                                                                                                                                      |
| `record_path`        | Where it was when the entry was recorded                                                                                                               |
| `record_type`        | Its document type                                                                                                                                      |
| `record_exists`      | Whether it still existed when the export was written: `yes` or `no`                                                                                    |
| `lifecycle_state`    | Its lifecycle state then                                                                                                                               |
| `comment`            | The entry's comment: a hold's description, a rule's id, a disposition run's decision in a sentence                                                     |
| `retain_until`       | For a retention set or extended, and a view: until when                                                                                                |
| `run_number`         | For a disposition run's entry: the run's number                                                                                                        |
| `run_uid`            | And its id                                                                                                                                             |
| `certificate_uid`    | For a record disposed of: its certificate's id                                                                                                         |
| `certificate_sha256` | And the SHA-256 of the certificate's CSV                                                                                                               |
| `download_reason`    | For a file read: `download`, `view`, `preview` or `rendition`, as the platform says                                                                    |
| `blob_xpath`         | Which file: `file:content`, or a rendition's or a picture view's                                                                                       |
| `file_name`          | The file's name                                                                                                                                        |
| `category`           | The audit's category: `records` for the add-on's entries, `eventDocumentCategory` for most of the platform's                                           |
| `extended`           | The rest of the entry's extended information, as one line of JSON with its keys sorted: a run's starter and approvers, an approval's number, and so on |

The kinds, by event ID:

| Kind          | Events                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retention`   | `afterMakeRecord`, `retentionRuleAttached` (the retention module's), `afterSetRetention`, `afterExtendRetention`, `afterUnsetRetention`, `retentionExpired`, `retentionActiveChanged` |
| `hold`        | `afterSetLegalHold`, `afterRemoveLegalHold`                                                                                                                                           |
| `disposition` | The add-on's: `dispositionRunStarted`, `dispositionRunApproved`, `dispositionRunRejected`, `dispositionRunHalted`, `recordDisposed`                                                   |
| `deletion`    | `documentRemoved`, `versionRemoved`, `proxyRemoved`                                                                                                                                   |
| `read`        | `download` (the platform's), `recordViewed` (the add-on's)                                                                                                                            |
| `export`      | `recordsAuditExported`                                                                                                                                                                |
| `change`      | The platform's other document events: created, modified, moved, permissions changed, locked, versioned, trashed, a lifecycle transition, and so on                                    |
| `other`       | Anything else, under its own event ID                                                                                                                                                 |

**The CSV,** `records-audit-<export id>.csv`, the export's main file: as the certificate's, RFC 4180,
every field in double quotes, UTF-8 with a byte order mark, times as UTC instants, and a field a
spreadsheet would read as a formula starts with `'`. **The JSON file,** `records-audit-<export
id>.json`, its attachment: `{"export": {...}, "entries": [...], "summary": {...}}`, the export's
scope, period, filer, the format's version and the columns first; an object per row with the CSV's
column names, numbers as numbers, `record_exists` a boolean and `extended` an object; and last the
counts and the CSV's SHA-256, so that the JSON file vouches for the CSV.

### Kept as written

- **Each file's SHA-256** is on the export, `rexp:csvSha256` and `rexp:jsonSha256`, and in its audit
  entry; the CSV's is in the JSON file too.
- **The export is made a record** once written: the repository keeps its CSV, its main file, as
  written, whoever asks. Its JSON file, its figures and everything else of the add-on's are refused
  to anyone but the add-on, administrators included, as a run's are; it is not moved, copied, put in
  the trash or restored, and only an administrator deletes it.
- **It is its filer's alone:** once filed, it blocks what it would inherit and grants Read to its
  filer, so that the folder's other readers do not see who read what. An administrator reads every
  export, as every document.

### What a records specialist checks in the export

The phase's "Done when" is that a records specialist accepts the disposition audit export. What
they are asked to check, for a seeded period with a disposition run in it:

1. **The scope and the period** in the JSON file's `export` object are the ones asked for, and the
   filer and the time are theirs; the export page says the same.
2. **The checksums:** the SHA-256 of each file, computed on their own machine (`shasum -a 256`), is
   the one on the export page, and the CSV's is the JSON file's `summary.csv_sha256`.
3. **The counts:** the CSV's rows, less its header, are `rexp:entryCount` and the JSON file's
   `summary.entries`; and `rexp:omittedCount` is 0 for a specialist who may read every record, or
   they are told what they may not read.
4. **Each record disposed of** has, in order: its rule applied and its retention (`retention`), the
   end of its retention, the run that held it (`dispositionRunStarted`, with the starter), two
   approvals by two other people (`dispositionRunApproved`, approvals 1 and 2), its disposal
   (`recordDisposed`, with the run, the certificate's id and the certificate's SHA-256), and the
   platform's own deletion (`documentRemoved`, by `system`), with `record_exists` `no`.
5. **The certificate agrees:** each `recordDisposed` row's `certificate_uid` and
   `certificate_sha256` are those of the run's certificate, whose CSV lists the same records.
6. **Holds:** each hold placed and lifted in the period is there, with its description, by whom and
   when; a record under a hold was in no run that disposed of it.
7. **Reads:** views and file reads of the records under retention are there, by whom and when, and
   the kind of read (`download_reason`); the specialist knows what is not logged (below).
8. **Nothing outside:** no row is outside the folder or the period.

None of this has been done with a records specialist: the add-on is installed on no server.

## Access logging

**What the platform already logs, and the add-on uses as it is.** Its audit records who, when and
which document for every one of these, with the time it happened:

| What                                            | The platform's event                                                                                           | Who logs it                                                                                                                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A record made, retention set, extended or ended | `afterMakeRecord`, `afterSetRetention`, `afterExtendRetention`, `retentionExpired`                             | The platform's audit, LTS 2025 and 11.5 alike                                                                                                                                                                      |
| A retention rule applied                        | `retentionRuleAttached`, `afterUnsetRetention`                                                                 | The retention module's audit configuration                                                                                                                                                                         |
| A legal hold placed or lifted                   | `afterSetLegalHold`, `afterRemoveLegalHold`, with its description as the comment                               | The platform's audit                                                                                                                                                                                               |
| A deletion                                      | `documentRemoved`                                                                                              | The platform's audit                                                                                                                                                                                               |
| **A file downloaded or shown**                  | `download`, with `downloadReason` (`download`, `view`, `preview`, `rendition`), `blobXPath` and `blobFilename` | The platform's download service, for every file it sends: the REST API's `@blob`, `@preview` and `@rendition`, and `nxfile`. A request for part of a file, after its first byte, is not logged again, nor a `HEAD` |

So downloads are the platform's, and the add-on adds no entry beside them. Found in the LTS 2025.10
server's own jars, read only: its `nuxeo-platform-audit-core` lists these events, and its download
service fires `download` for every file it sends; no event of the platform's, and none in its 181
bundles, records a document read without its file.

**What the add-on adds:**

- **A view,** `recordViewed`: a record under retention or a legal hold sent to a person as a
  document of its own, by the REST API's JSON writer for a document, which the add-on replaces with
  a subclass that writes the same JSON (`RecordViewJsonWriter`). A view is the document as the
  answer itself, the JSON's root, as the REST API answers a request for the document, its path, an
  update of it, or an operation returning it. Its entry says who (the person whose session read it,
  or the person the server is answering when it read it with its own), when, the record's id, path,
  type and lifecycle state, until when it is retained and whether it is held.
- **A disposition run's decisions,** one entry per record of the run: held in the run, each approval,
  rejected or withdrawn, halted with why, and disposed of with the run, its approvers and its
  certificate. The platform logs the deletion itself as the add-on's session's, `system`, so without
  these a record's history would not say who decided.
- **An export written,** `recordsAuditExported`, on the export.

Each is an event of the add-on's, fired in the transaction of what it records, so that a refused or
failed request, or a read whose transaction is rolled back, records nothing. `RecordsAuditWriter`
adds them to the platform's audit, once that transaction has committed, in the background, one call
per transaction: the platform builds each entry from its event, as it builds its own, and each names
its document as it was when the event fired, so that a record disposed of in the same transaction is
still named. The writer needs no entry in the audit's own configuration, whose extension point is
not the same on every LTS 2025 server (`event` on 2025.10, `routes` on the builds the retention
module's newest version needs).

**What it costs a read** (`RecordAccessCostTest`, 26 November 2026, on a laptop): a person's request
for a document that is no record, read, written as JSON and committed, 102 to 228 µs over six runs;
the same request for a record under retention, 190 to 315 µs; so a logged view adds **71 to 126 µs a
read**, the two highest while the repository's gates ran beside it. Best of three rounds of 400 reads
each; the test refuses more than 2 ms. For a document that is no record under retention, the check
reads only what the document already holds.

**What it costs afterwards,** off the reader's time: the add-on's writer builds the view's entry and
adds it to the audit in the background, one work and one write per read transaction, **40 to 47 µs
an entry** on the tests' audit, a JPA store in H2 (the same test, measured, not bounded). On a server
the write goes to the audit's own store, on LTS 2025 OpenSearch, one request per transaction, where
the platform batches its own entries through a stream; on a server whose work queues are streams,
the event is serialised once per transaction for the work.

**What is not logged,** for the review and the specialist:

- **A record listed:** a page of search results, a folder's children, or a document a property
  names, is not a view, or every list would log every record it shows. The record's own page is.
- **A record whose retention has ended,** or that is under neither retention nor a hold: its
  downloads are, by the platform, and its views are not.
- **A proxy** of a record: it is not under retention itself.
- **What does not go through the JSON writer:** a CSV export of search results, the XML export, or
  a read by a script on the server. The server's own reads, for no one, are not a person's.
- **A view's properties:** the entry says the record was sent, not which properties the request
  asked for.
- **Another add-on's writer:** should one replace the platform's JSON writer for a document at the
  same priority, one of the two would be used; `AccessLogTest` holds the registry to the add-on's,
  and a server with such an add-on must be checked.

## How a person reaches it

A **listener**, not the route model: `DispositionListener`, synchronous, on the repository's
document events. A workflow's task would need its node's chain to call an operation, which the app
could then reach too; a document event needs none.

A person files a **`DispositionRequest`** in the repository's **`DispositionRuns`** folder, which an
administrator makes at the repository's root, over the REST API (`POST /api/v1/path/<the folder>`),
with `dreq:action`:

| Action    | Also       | Who                                                                                      | What it does                                                                                        |
| --------- | ---------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `start`   |            | `StartDisposition` on the folder                                                         | A new `DispositionRun` holding the records due that the person may read; refused, 409, when none is |
| `approve` | `dreq:run` | `ApproveDisposition`, and not the run's starter                                          | An approval; the second, by another person, disposes of the run, or halts it                        |
| `reject`  | `dreq:run` | `ApproveDisposition`, or the run's own starter with `StartDisposition`, who withdraws it | The run is closed, its records kept, and free for another run                                       |

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
  would read as a formula (`=`, `+`, `-`, `@`, a tab, a carriage return) starts with `'`, so such a
  title reads in the CSV with a `'` the certificate's properties do not have.

The run keeps the certificate's id and the CSV's SHA-256 too.

## Security notes, for the review

- **Who may do what is the folder's ACL.** `StartDisposition` and `ApproveDisposition` each include
  Read and AddChildren. Nuxeo counts `Everything` as holding both, and administrators as holding
  all: the folder **must block every permission it would inherit**, and the add-on refuses every
  request in one that does not, 409, so that an inherited `Everything` grants neither.
- **One folder per repository, at its root,** made by an administrator alone, so that no one makes a
  folder of their own where they hold `Everything`, and no run misses another's records. At the root
  because the repository deletes, trashes, moves and copies a folder's contents with no event of
  their own: under a workspace, whoever could delete or copy the workspace could delete every run
  and certificate, or copy the folder into a second one with its pending runs and their approvals.
  Above the root's folder there is only the root. A folder an administrator has moved, trashed or
  copied takes no request until it is the one folder at the root again.
- **The two-person rule** is checked on the server, against the run as the last request left it:
  the starter may not approve, nor anyone twice, with names compared without their case, as
  `LayerService` compares an approver with a draft's makers. The system and anonymous users file
  nothing.
- **Disposal is the add-on's session's,** once the two approvals are in: an approver needs no Remove
  permission on the records, so `ApproveDisposition` is a strong permission, for the few people a
  records schedule names. A run holds only records its starter may read, so a run shows no one a
  record its starter could not see; the people who may read the folder see the run's list.
- **One at a time, each in a transaction of its own.** Every request is taken inside one lock, the
  server's and, in a cluster, the cluster's, as `LayerService` makes its changes inside both. The
  cluster's is an entry of the cluster's key-value store, the one `ClusterService` keeps its locks
  in, set only when free and held at most 10 minutes; not `ClusterService.runAtomically` itself,
  which in a cluster commits its caller's transaction before it runs the work. Inside the lock the
  request runs in a transaction of its own, suspended from the person's and committed before the
  lock is given back. Two approvals at once are taken one after the other: one person's second is
  refused, and a run is disposed of once. A request whose transaction fails writes nothing, and its
  records are back. The person's own transaction is never committed by the add-on: a refusal rolls
  it back whole, what the person wrote before the request included. The request document is written
  afterwards, by the person's transaction: should that one fail after the request's own committed,
  the run keeps what was done, and the request document is missing. The run is the record of what
  was decided.
- **Everything else on the add-on's documents is refused**, administrators included: a run or a
  certificate made by anyone but the add-on, any of its documents imported, a change to a property of the add-on's schemas or a
  certificate's file, a move, copy, check-in, restore or trash. A deletion is an administrator's
  alone, and is logged. Hiding a run in the app is not the control: this is.
- **The logs** name who did what, and never a record's title. Names are written with control
  characters replaced, so no one writes a line of their own into the log.
- **The audit export's permission** is `ExportRecordsAudit`, on the same folder, which must block
  what it inherits, as for a request; administrators hold it, as every permission. It is a strong
  permission, for the few records specialists a records schedule names: an export lists who read
  which record and when, and every change the audit holds of the documents under a folder the filer
  may read. An entry about a document the filer may not read is left out and counted; one about a
  document that no longer exists is kept when the filer may read the nearest folder above it that
  still does.
- **An export is written as its filer,** in the background, with the person their request was
  filed as: what they may read is judged with their groups as they were then.
- **An export is its filer's alone:** in the filer's own transaction, once created, it blocks what
  it would inherit and grants Read to its filer. The folder's other readers, starters and approvers
  included, do not see it.
- **An export is kept as written:** its CSV as a record's main file, which the repository refuses to
  replace; its JSON file, its figures and its checksums by the add-on's guard, as a run's
  properties are; each file's SHA-256 on the export and in its audit entry, and the CSV's in the
  JSON file. The CSV's fields that a spreadsheet would read as a formula start with `'`, as the
  certificate's do.
- **Access logging is a record, not a control:** a view is logged after it is sent, and nothing is
  refused because of it. Should the audit refuse the add-on's entries, the read is not refused, and
  the server's log says how many entries, and of which events. A view is the person's whose session
  read the record, or, when the server read it with its own while answering a person, that person's;
  the server's own reads, for no one, are not logged.
- **The add-on writes to the audit through its own listener,** the platform building each entry from
  its event; it adds entries and never changes or removes one.
- **What it does not close:**
  - a hold put on in the instant of a disposal, by a transaction that has not committed when the
    disposal reads the record, is not seen by the add-on; the repository's own check at deletion has
    the same window;
  - a request filed by a script that has itself written a record in the same transaction could wait
    on its own lock, until the database's lock timeout;
  - the add-on is a control only as far as the server's administrators: one of them may delete a run
    or a certificate, or uninstall the add-on;
  - the run's records list is a copy, as the starter could read the records: if a record's title is
    itself sensitive, the folder's readers see it;
  - an approval is counted as it was given: one whose approver has since lost `ApproveDisposition`
    still counts at the second approval;
  - a start reads at most 5000 candidates, the oldest retention end first: if as many are held or
    not due, a record due after them waits for a later run;
  - two servers of a cluster are held apart by the cluster's key-value store, which the tests run in
    memory, on one server: no test runs two servers;
  - should a server stop while it holds the cluster's lock, the others wait for it to expire, 10
    minutes, refusing each request after 30 seconds, 409, to be filed again; on one server, a request
    waits for the one before it with no limit;
  - whoever may file in the runs folder may file a document of another type there, such as a file
    titled like a certificate: the queues list the add-on's types alone, and browsing the folder
    shows it;
  - an approver may make a live proxy of the folder or of a run in a folder of their own, which shows
    the run's records list to that folder's readers; a proxy is no second folder, and takes no
    request;
  - an export keeps the entries of a document that no longer exists under a folder its filer may
    read, though the filer may not have been able to read the document itself: its id, path, type,
    and who read or changed it;
  - an export is as complete as the platform's audit: an entry the audit never wrote, or has since
    purged, is not in it, and the add-on cannot tell;
  - an export covers a folder by the paths the audit recorded: a record moved out of the folder
    appears until its move only;
  - a view entry is written once the read's transaction has committed, in the background: a server
    that stops between the two loses it, as the platform's own entries are written a moment after
    their change;
  - what access logging does not log: a record listed, a record no longer under retention or a hold,
    a proxy, and a read that does not go through the REST API's JSON writer for a document
    ("Access logging");
  - an add-on that replaces the same JSON writer at the same priority would turn views off;
  - an export's background transaction lasts up to four hours: a longer one fails, and is filed
    again over a shorter period;
  - an entry the audit writes more than the settling time after its event, or one a transaction
    holds back while later entries are written, is not in an export whose period has just ended:
    filed again later, it is;
  - the platform's audit shows a document's entries, its views and downloads included, to whoever
    may read the document (its REST adapter, `@audit`). The kit's record page shows reads to records
    managers only, which is not a control: the export is its filer's alone because it lists the
    reads of every record of a folder;
  - each read transaction that views a record costs the add-on's writer one background work and one
    write to the audit, where the platform batches its own entries through a stream;
  - the add-on's LTS 2025 paths to the audit (`AuditAccess`) are tested against stand-ins, since
    the tests run on 11.5's platform; no LTS 2025 server has run them.

## What is not built

- **Physical records,** with locations, barcodes and chain of custody.
- **The specialist's acceptance** of the audit export, phase 9's "Done when": the export is built and
  tested, and no records specialist has seen one ("What a records specialist checks in the export").
- **Tenancy**, decision G, which the plan says is designed with the platform team.
- **A button in the app.** Decision 3 is open; a run is started and decided, and an export filed,
  over the REST API. The app's create dialog asks a file of any type with the `file` schema, and an
  export's CSV is that file, so that the repository keeps it: an export has no create form.
- **A disposition schedule.** A run is started by a person; nothing starts one on a timer.

## Tests

In Nuxeo's own test framework (`FeaturesRunner`, `CoreFeature`): a real repository with the
platform's retention, hold, security and transactions, the add-on's bundle as it ships, and the
retention module's model from its jar. Nuxeo's 11.5 test framework is the last on the public
repository; on Java 21 it needs a newer ASM and Chronicle Queue, which the pom pins for the tests
alone, and some JDK packages opened.

| Test                        | What it proves                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DispositionRunTest`        | Which records a run holds and which it does not; two approvals dispose and certify; a rejection frees the records; the platform's own expiry makes a record due                                                                                                                                                                                                                |
| `DispositionRefusalTest`    | Every refusal: no permission to start or approve, the starter's approval, a second by the same person, a hold, a retention or a retention end since the start, a record gone                                                                                                                                                                                                   |
| `DispositionAtomicityTest`  | A failure partway through disposes of nothing; two approvals, two second approvals, one person's two, and two starts, at once                                                                                                                                                                                                                                                  |
| `DispositionGuardTest`      | The add-on's documents are its own; one folder per repository, an administrator's, at the root; a folder moved from it, or that inherits, takes no request                                                                                                                                                                                                                     |
| `DispositionClusterTest`    | On a server in a cluster: a run disposed of, a refusal that rolls the person's transaction back whole, and two approvals at once                                                                                                                                                                                                                                               |
| `CertificateCsvTest`        | The CSV's rows, quoting and formula guard                                                                                                                                                                                                                                                                                                                                      |
| `RetentionModelTest`        | What the add-on reads of the module, held to the module's own files; the module's audited events, as the tests register them                                                                                                                                                                                                                                                   |
| `BundleTest`                | The bundle's version is the package's; it contributes no operation and no endpoint; the package depends on the module                                                                                                                                                                                                                                                          |
| `AuditExportTest`           | Refused without the permission, and what it cannot cover; filed in the runs folder alone; its contents for a seeded period; a period longer than a page; its checksums; kept as written; its filer's alone; the folder by path or id; the server writes the rest                                                                                                               |
| `AuditExportGenerationTest` | Written once; waits for its period to settle, so that an entry written after the filing is in it; an export whose audit fails, or whose filer is not known, keeps nothing and says so                                                                                                                                                                                          |
| `AccessLogTest`             | A view of a record under retention or a hold logged with who, when and what, and nothing else's; a record listed is not viewed; the server's own reads, and a read for a person; a read rolled back; a view that cannot be recorded does not refuse the read; a download is the platform's own entry; the registry picks the add-on's writer, which writes the platform's JSON |
| `RecordAccessCostTest`      | What a logged view adds to a read, measured, and held under 2 ms; what its entry costs the background, measured                                                                                                                                                                                                                                                                |
| `DispositionAuditTest`      | A run's decisions in each record's history: held, approved twice, disposed of with its certificate; rejected; halted; a refusal records nothing                                                                                                                                                                                                                                |
| `AuditAccessTest`           | The audit reached on 11.5 and, through stand-ins, as on LTS 2025: its service's default store, and an entry's extended information                                                                                                                                                                                                                                             |

The audit tests run the platform's own audit, as its `AuditFeature` deploys it, its JPA store in H2,
through `RecordsAuditFeature`, whose waiter waits for an entry of its own rather than the audit
stream's lag, which the Chronicle Queue pinned for Java 21 does not report.

**Each refusal was seen failing without its check**: every check above was removed in turn, and its
test failed (26 November 2026): the start and approve permissions, the self-approval and its case,
the second approval by one person, the re-check at disposal and the hold check itself, the record
in one run at a time, the server's lock, the one transaction, the folder's block, the add-on's
properties, the administrator's deletion, the server's runs and certificates, the one folder, the
rule's end action, the retention end, the retention, and the CSV's formula guard; then, after the
review, the folder at the root, a request taken only there, the add-on's own documents, folders
and documents holding others never due, a run withdrawn by its own starter alone, and the
cluster's lock leaving the person's transaction alone (with `ClusterService.runAtomically` in its place, a refused request kept what the
person wrote before it). A wrong SHA-256 for the module's jar fails the build.

**The audit export's and access logging's checks, seen failing** the same way (26 November 2026),
each taken out in turn, and the test that holds it went red: the export's permission, the folder its filer may read, an unreadable document left out, the scope held exactly, the period, every page read, the CSV's checksum, the export made a record, its files and figures guarded, the export its filer's alone, the server writing the rest of it, an export written once, a failed export keeping nothing, a view at the answer only, a record under retention only, the server's own reads, the writer writing, a disposed record's entry, a document kept as fired, the cost's bound, a period ending when the export is filed, the period settled before it is read, a view's failure never refusing the read, and the LTS 2025 entry's extended information.

```bash
mvn verify -pl nuxeo-agentic-records -am
```

## What is in it

| File                                               | What it is                                                                                                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/java/org/nuxeo/agentic/records/`         | The listener, the requests and the disposal, the records due, the certificate's CSV; the audit export and its files; the add-on's audit entries, their writer, and the JSON writer that logs a view |
| `src/main/resources/OSGI-INF/records-types.xml`    | The five types and their schemas, after the retention module's                                                                                                                                      |
| `src/main/resources/OSGI-INF/records-security.xml` | `StartDisposition`, `ApproveDisposition` and `ExportRecordsAudit`                                                                                                                                   |
| `src/main/resources/OSGI-INF/records-listener.xml` | The listener                                                                                                                                                                                        |
| `src/main/resources/OSGI-INF/records-audit.xml`    | The JSON writer for a document, the audit entries' writer, and the export's                                                                                                                         |
| `src/main/package/`, `src/main/assemble/`          | The Marketplace package, `nuxeo-agentic-records` 0.2.0, which depends on `nuxeo-retention`                                                                                                          |
| `src/test/`                                        | The tests, the module's types and audited events as the tests register them, the platform's audit as the tests deploy it, and test-only listeners and stand-ins                                     |

`nuxeo.agentic.records.audit.export.settleSeconds`, in `nuxeo.conf`, sets how long after its period's
end an export waits before it reads the audit, 0 to 600, 30 by default.

`nuxeo.agentic.records.disposition.maxRecords`, in `nuxeo.conf`, sets the most records a run holds,
1 to 1000, 200 by default, so that a disposal is one transaction of a bounded size.
