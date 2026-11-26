# nuxeo-agentic-documents: numbering, supersession, transmittals, review cycles and export-control marks, on the server

The document control module's server add-on ([development plan](../docs/business-apps/development-plan.md),
phase 8, "The document control add-on"), version 0.3.0: numbering, revisions and supersession, its
first slice, 0.1.0; transmittals, and review cycles with comment resolution, its second, 0.2.0; and
export-control marks, its third, 0.3.0, which completes the add-on the plan lists. A Maven module
beside `nuxeo-agentic-core`, with its own Marketplace package, `nuxeo-agentic-documents`. The
[controlled documents kit](../business-apps/packages/controlled-documents-demo/README.md) is built
on it.

**Built against an open decision.** Decision B, the packaging of the server tier, is open; this
follows its recommendation, "`nuxeo-agentic-core` for the runtime essentials; one add-on per domain
module" ([decisions.md](../docs/business-apps/decisions.md), and its note). Nothing of it went into
`nuxeo-agentic-core`. Decision C, outside users, is phase 8's portal and is not built here: a
transmittal goes to named people inside the server.

**Its security review is deferred until the app is finished,** as every security review is
([security-reviews.md](../docs/business-apps/security-reviews.md)): nothing here is to be relied on
outside a development or demonstration server until it is done. "For the security review", below,
is what that review is to check. Version 0.1.0 is installed on the local Docker Nuxeo; 0.2.0 and
0.3.0 are installed nowhere: each was built and tested on a Nuxeo runtime in the build's JVM, and
checked against the local server's own jars, read only.

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
- **A transmittal lists controlled documents at their revisions, sent to named people** for review,
  for construction or for information, by a due day. It is issued when it is created: the issuer
  names each document by its number or its id, the server writes back the current revision's id,
  and keeps its number, revision and title as they were; numbers it in the series registered for
  transmittals, `TR-00012`; and creates, as the issuer, a **receipt** beside it for each recipient,
  `awaiting`. Nothing of the transmittal changes afterwards.
- **Each recipient answers their receipt once,** `acknowledged`, or `returned` with a comment, by
  saving it, and the server writes when. Anyone else's answer is refused, an administrator's
  included; so is a second one, and any other change to the receipt. The receipt is the server's
  record of who answered what, and when.
- **A review cycle reviews one revision, in Nuxeo's own comments.** Its opener, who must be able to
  write the revision, names the reviewers. Each comment a reviewer, or the opener, writes on the
  cycle is given the add-on's `ReviewComment` facet, and a thread's first comment is `open`; anyone
  else's comment is refused. The opener resolves each thread, or opens it again, and the server
  writes who and when.
- **A cycle closes only with no thread open,** at its opener's asking. The check is the server's:
  a close is refused while one thread is open, and a comment and a close cannot cross, through a
  fence in the key/value store. The closed cycle is added to the revision's `docrev:cycles`, as
  the opener. Nothing of a closed cycle, or its comments, changes afterwards.
- **An export-control mark, since 0.3.0,** on a revision: a classification, such as a fictional
  `EC-2`, and the groups that may receive it, in the `ControlledDocument` facet's third schema,
  `export_mark`, prefix `docmark`. The server refuses the revision's files and renditions at the
  platform's download endpoints, through its own download permission, and a transmittal of it, to
  anyone in none of those groups, an administrator included, with the server's reason (below, "Export-control marks").
- **A mark is carried, and changed only with the add-on's permission.** A new revision takes the
  mark of the one it supersedes, whatever its creator wrote. Setting, changing and removing a mark
  needs `ChangeExportMark`, the add-on's own permission; the server writes who and when, and each
  change is an entry in the platform's audit, `exportMarkChanged`.
- **No Automation operation, and no button.** Each is reached by creating or saving a document,
  through the REST API's document endpoints or Nuxeo's comment endpoint, which every client uses
  (below, "Transmittals and review cycles: listeners, not a route model"). The marks' refusals are
  the platform's download permission's, which every download endpoint asks.

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

| Change                                                                                                                                                | Answer     | Why                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------- |
| A new document with no series, or one not registered                                                                                                  | 400        | It cannot be numbered                             |
| `docctl:supersedes` not an id, of no document, or of one not a live controlled one                                                                    | 400        | There is nothing to supersede                     |
| Superseding a document the user may not read                                                                                                          | 403        | As the platform answers a read of it              |
| Superseding a revision of another type                                                                                                                | 400        | A revision is of its predecessor's type           |
| Superseding a revision in the trash, superseded, being superseded, or with no number                                                                  | 409        | Only the current revision is superseded, once     |
| Superseding a revision the user may not write                                                                                                         | 403        | It could not be marked superseded                 |
| Any change to a `docctl:` property on a save, by anyone, or through a live proxy                                                                      | 400        | They are the server's                             |
| The facet added to a document, at creation or after, or removed                                                                                       | 400        | A type decides what is controlled                 |
| Copying a controlled document, or a folder holding one, readable by the user or not                                                                   | 400        | The copy would carry the number                   |
| Restoring a version whose `docctl:` properties differ from the live document's                                                                        | 409        | A superseded revision would be made current again |
| Since 0.3.0: a mark's classification or groups changed without `ChangeExportMark`                                                                     | 403        | The add-on's permission marks a revision          |
| A mark written that is not one: its form, no group, a group the server lacks                                                                          | 400        | A mark names groups the server has                |
| `docmark:markedBy` or `docmark:markedAt` written                                                                                                      | 400        | They are the server's                             |
| A mark changed through a proxy or a version, or restored from a version                                                                               | 400 or 409 | A mark is changed on the revision itself          |
| A mark changed while a new revision or a transmittal reads it                                                                                         | 409        | Try again: the two cannot cross                   |
| A marked revision, or a folder holding one, moved, or its next revision created in another folder, without `ChangeExportMark` on it and where it goes | 403        | Where it is decides who may change its mark       |

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

**Not exempt** from any of the refusals above, nor from those of transmittals, review cycles and
export-control marks below: no check reads the user's groups but the one for deleting, and a
mark's own, which reads them to ask whether the person is in one of its groups, and
`GuardTest.noSaveChangesAControlledPropertyNotEvenAnAdministrators`,
`TransmittalTest.anAcknowledgementBySomeoneNotARecipientIsRefused` and
`ReviewCycleTest.onlyTheOpenerResolvesAndTheServerWritesWho` act as one. An administrator may
delete or trash a transmittal, a receipt, a review cycle, or a closed cycle's comment, which no one
else may, and the add-on logs it at `WARN`; a privileged session that server code opens on a user's
behalf, as Nuxeo's comment manager opens one to delete its author's comment, is the platform's
administrator and is not taken for one. Where the platform makes an exemption unavoidable:

- **An administrator controls the server's configuration:** they can disable the listeners in the
  administration screens, install a package that removes a series, reset a sequence, or delete a
  claim or a fence, which no add-on can refuse.
- **`CoreSession.importDocuments`, administrators only,** writes documents as they are given, with
  no `aboutToCreate`: an import carries its numbers, receipts and resolutions unchecked.
- **Server code with an unrestricted session** is not held to the user's permissions, so a chain
  run unrestricted may supersede what its caller could not write. Its answers and resolutions are
  held to who it acts for, and refused when it acts for no one the receipt or the cycle names.

## Transmittals

A kit's type carries the `Transmittal` facet, schema `transmittal`, prefix `trm`, and another its
receipts, `TransmittalReceipt`, `transmittal_receipt`, `trr`. Neither need be a folder: the
controlled documents kit's are not, so each opens as a record page. Exactly one series is
registered `for="transmittals"`, below, and exactly one type carries the receipt's facet.

**Issued on creation.** A transmittal is a record of what was sent, so it is complete when it is
created, as a revision is, and is never a draft that changes later:

| Property                       | Written by     | What it is                                                                                                                                                               |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dc:title`                     | The issuer     | The subject, 1 to 200 characters                                                                                                                                         |
| `trm:documents`                | Issuer, server | 1 to 100 documents, each by its number, `DWG-00042`, or its id. The server writes back each one's id: a number names its current revision, an id must be the current one |
| `trm:items`                    | The server     | Each document as it was when issued: `document`, its id, `number`, `revision` and `title`                                                                                |
| `trm:recipients`               | The issuer     | 1 to 50 user names, each once                                                                                                                                            |
| `trm:purpose`                  | The issuer     | `review`, `construction` or `information`                                                                                                                                |
| `trm:dueDate`                  | The issuer     | A day, today or later; a day before today in UTC is let through, for a zone behind UTC                                                                                   |
| `trm:number`                   | The server     | The next number of the series for transmittals, taken last, once nothing else can refuse it, so a refused transmittal spends none                                        |
| `trm:issuedBy`, `trm:issuedAt` | The server     | Who created it, and when                                                                                                                                                 |
| `dc:description`               | The issuer     | A message, optional                                                                                                                                                      |

- **Held to each document's export-control mark, since 0.3.0:** every recipient must be in one of
  the groups of each marked document it lists, as the user directory has them, or the transmittal
  is refused, 403, with nothing written and no number spent, naming each recipient a mark excludes,
  from which document, and the mark: "Not sent: export-control marks exclude mlind from DWG-00004
  at revision B, marked EC-2, for ec2-cleared." A name no user holds is in no group (below,
  "Export-control marks").
- **What the issuer sends is what they may read.** A number is looked up with the issuer's own
  session: a revision they may not read is not found, 400, the same answer as no revision; an id
  they may not read is refused, 403, as the platform answers a read of it. A superseded revision, a
  revision in the trash, and a document that is not a live controlled document are refused.
- **Whatever the issuer writes in the server's properties is replaced,** as for a revision.
- **One receipt per recipient, beside it,** created in `documentCreated` as the issuer, held to
  their permissions as anything they create is, and marked as the add-on's own write
  (`ServerWrite.RECEIPT`, an object a client cannot put in a document's context data). A receipt
  a client creates is refused, 403. Its name is the transmittal's number and the recipient's place,
  `tr-00012-1`, short of Nuxeo's 24-character limit. It carries the transmittal's id, number,
  purpose, due day and issuer, so that a queue lists it with no lookup, its recipient, and its
  status, `awaiting`.

**Answered once, by its recipient.** A recipient saves their receipt with `trr:status`
`acknowledged`, or `returned` and `trr:comment`; the server writes `trr:respondedAt`. Through the
REST API's `PUT /api/v1/id/{receipt}`, which the kit's Edit form sends.

- **Only the recipient,** by the name the server reads as acting: the user signed in, or the one a
  privileged session acts for. Anyone else is refused, 403, whatever their permissions, the issuer
  and an administrator included. The recipient needs `WriteProperties` on the receipt, which the
  receipt inherits from where it is: one who may not write it is refused by the platform first.
- **Once.** An answered receipt is not answered again, 409. Two answers at once, from two windows,
  would each find it awaiting: each **claims** it first, key `receipt.<id>`, in the store the
  supersession claims are in, with the same release if the transaction does not commit, and only
  one gets through (`WorkflowConcurrencyTest.oneReceiptAnsweredManyTimesAtOnceTakesOneAnswer`).
  Writing back the answer already stored, the same status and comment, changes nothing and is no
  second answer.
- **Nothing else changes, before or after:** any other `trr:` property, and the title, are the
  server's, 400; a comment is 4000 characters at most.
- **Many recipients at once lose nothing.** Each answers their own document, so no answer is
  written over another's (`manyRecipientsAnsweringAtOnceAreEachKept`, 16 at once). The transmittal
  itself holds no count of answers, which two answers at once could each write from a stale copy:
  the receipts, listed by a page provider, are the record.

**Kept.** A transmittal and its receipts are not deleted or trashed but by an administrator, 403,
nor copied, 400, nor restored from a version that would change them, 409. Nor is a document that
holds one, or a review cycle or one of its comments, a folder or not, since the repository lets a
document be created below any other: it deletes and trashes a document's children with no event of
their own, so a privileged query below any document being deleted or trashed that has children
finds what it holds, 403 for anyone but an administrator. A proxy or a version may be removed: it
is not the record.

## Review cycles

A kit's type carries the `ReviewCycle` facet, schema `review_cycle`, prefix `rvw`. Reviewers write
in **Nuxeo's own comments**, on the cycle: the platform's comment endpoint
(`POST /api/v1/id/{cycle}/@comment`), its Comments panel, and layout version 2's comments card all
write them, through Nuxeo's comment manager. The add-on gives each comment written in a cycle its
`ReviewComment` facet, schema `review_comment`, prefix `rvwc`, on the comment itself: Nuxeo's
`Comment` type is not changed, and a comment anywhere else is left as Nuxeo writes it.

| Property                                       | Written by     | What it is                                                                                                                         |
| ---------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `rvw:document`                                 | The opener     | The id of the revision reviewed: a live controlled document, current, that the opener may write                                    |
| `rvw:reviewers`                                | The opener     | 1 to 50 user names                                                                                                                 |
| `rvw:dueDate`                                  | The opener     | Optional; today or later                                                                                                           |
| `rvw:number`, `rvw:revision`                   | The server     | The revision's, when the cycle opened                                                                                              |
| `rvw:status`                                   | Server, opener | `open`; the opener asks for `closed`                                                                                               |
| `rvw:openedBy`, `rvw:openedAt`                 | The server     | Who opened it, and when                                                                                                            |
| `rvw:closedBy`, `rvw:closedAt`, `rvw:comments` | The server     | Who closed it, when, and how many threads it had                                                                                   |
| `rvwc:cycle`                                   | The server     | On each comment in the cycle, a reply's included: the cycle's id                                                                   |
| `rvwc:status`                                  | Server, opener | On a thread's first comment, `open`, then `resolved` or `open` again by the opener; empty on a reply                               |
| `rvwc:resolution`                              | The opener     | A note with a resolution, 2000 characters at most                                                                                  |
| `rvwc:resolvedBy`, `rvwc:resolvedAt`           | The server     | Who resolved it, and when; empty while it is open                                                                                  |
| `docrev:cycles`                                | The server     | On the revision, the `ControlledDocument` facet's second schema: each closed cycle, `cycle`, `closedBy`, `closedAt` and `comments` |

- **Opened by someone who may write the revision,** 403 otherwise, since the closed cycle is
  recorded on it as them. A superseded revision is not reviewed, 409. **One cycle at a time** on a
  revision: each new one claims it, key `review.<revision id>`, and a cycle open already, found by
  a privileged query, refuses it, 409. The claim is released when the cycle's close commits, so a
  revision can be reviewed again.
- **A comment in a cycle** is a comment written below the cycle: in its `Comments` folder, where
  Nuxeo's comment manager writes one, or below a comment there, where it writes a reply. Where it
  is, read with a privileged session from its folders, says so, never what the comment says of
  itself: a comment written as a plain document, past the comment manager, is held to the same
  checks, and one elsewhere whose `comment:parentId` or `comment:ancestorIds`, which Nuxeo's
  comment queries read, names the cycle or one of its comments is refused, 400, when written or
  when changed. Only the cycle's reviewers and its opener write one, 403 otherwise, an
  administrator included; and none while the cycle is closed, or closing, 409. The server writes
  `comment:author`, who acts, and `comment:parentId` and `comment:ancestorIds`, where it is, as the
  comment manager would; afterwards none of the three changes, 400, and only its author changes what
  a comment says, 403. A comment on a proxy or a version of a cycle is refused, 400.
- **Nothing is moved into a cycle,** where it would be a comment never written in it, **nor
  anything out of one,** a comment or its `Comments` folder, 403, but by an administrator. A rename
  in place moves nothing, and is let through: the trash renames a document so before it trashes it,
  and the trash's own rules then apply.
- **Resolved by the opener alone,** 403 otherwise, by a save of the thread's first comment,
  `PUT /api/v1/id/{comment}` with `rvwc:status` and `rvwc:resolution`. A reply is not resolved, 400. Any other `rvwc:` property is the server's, 400.
- **Closed by the opener alone,** 403 otherwise, by a save of the cycle with `rvw:status` `closed`,
  which the kit's Edit form sends: nothing else of the cycle changes, 400. **Refused, 409, while any
  thread is open,** counted by a privileged query of the cycle's comments as the repository holds
  them, so a comment the opener may not read counts too, and one in the trash does not, as the
  cycle's page does not list it. Closed, the server writes who, when and how
  many threads, and adds the cycle to the revision's `docrev:cycles`, as the opener, marked as its
  own write (`ServerWrite.REVIEW_RECORD`); the revision's guard lets that one entry, added after the
  others, through, and refuses every other change to `docrev:cycles`, an administrator's included.
- **Nothing of a closed cycle changes:** the cycle, 409; its comments, edited, resolved, opened
  again or deleted, 409, by anyone but an administrator deleting one.
- **A thread is resolved, not deleted:** while the cycle is open, only a comment's author deletes
  or trashes it, 403 for anyone else, the opener included; and not a comment with replies, which
  would go with it, nor the cycle's `Comments` folder, but by an administrator.
- **Kept,** as a transmittal is: not deleted or trashed but by an administrator, not copied, not
  restored from a version that would change it. An administrator deleting an open cycle frees its
  revision for another once the deletion commits; trashing one does not, since it may come back
  from the trash open.

### A comment and a close cannot cross

The repository lets two transactions write at once, each from what it read: a close that counts no
open thread could commit while a reviewer's comment, which found the cycle open, commits after it,
and leave a closed cycle with an open thread. `WorkflowConcurrencyTest` shows it: with the fence
below taken out, its first round already ended closed with an open comment, in two runs of two. So
each cycle has a **fence** in the key/value store, key `cycle.<id>`, changed by compare-and-set
only:

- **A comment written in the cycle, and any change to one,** enters it, adding one to the count of
  writers, and leaves it when its transaction ends, whichever way. It cannot enter while the cycle
  is closing or closed, 409. It enters before it reads the cycle's status, so that it reads it
  after any close it could cross has committed.
- **A close takes it only from nothing:** no writer in, no other close, 409 otherwise, "close it
  again". Taken, no comment is written until the close's transaction ends; committed, the fence
  says `closed` for the claims' time to live, a day, so that a transaction that read the cycle
  open before the close committed finds it so; after that, the cycle's own status refuses. Not
  committed, it is open again at once.
- **No way out, no way in:** the release is registered before the fence is entered or taken, as
  for a claim, and a transaction where it cannot be registered is refused, 409.
- **A server stopped mid-transaction** leaves its count, or its close, until the time to live
  expires: that cycle cannot close, or take a comment, until then.

## Transmittals and review cycles: listeners, not a route model

A route model, as the Payers kit's claims review is, would fit the shape: a task per recipient, or
per reviewer, with buttons, which Nuxeo's task service already refuses to anyone not an actor. The
add-on uses two synchronous listeners instead, `TransmittalListener` and `ReviewCycleListener`, as
it does for numbering, and as the records add-on does for its disposition review. Why:

- **The record is the document.** Who acknowledged what, and when, is on each receipt; which
  threads are open, on each comment; a closed cycle, on the revision. A queue of transmittals
  awaiting a person is a page provider over receipts, `$currentUser` given by the REST API, and a
  record page shows each one's fields. A route model keeps them in its nodes' task information and
  in the audit, which no layout reads.
- **No operation for a button.** A route model's steps run chains, which an app could reach through
  Nuxeo's Automation endpoint too; the add-on would then add operations to the allow-list, decision
  3's, or guard each chain. Creating and saving documents need neither: the platform's permissions
  hold them, and the listeners check the rest, whichever client sends the change.
- **The checks are the server's, in one transaction.** Each refusal marks the transaction for
  rollback, as numbering does, so nothing a refused answer, resolution or close wrote stays. The
  cycle's close check reads every comment as the repository holds it, which a task's completion
  would not.
- **Tested in the Nuxeo test framework, here,** with the platform's own transactions, key/value
  store and permissions, as the rest of the add-on is: a route model's engine is not in the tests'
  runtime, and would bring the routing, task and Automation services with it.
- **What a route model would have given, and this does not:** Nuxeo's task notifications by mail,
  a task's due day escalation, and the app's Tasks page. A receipt's due day is shown, and listed
  first in the queue, but nothing reminds anyone.

## Export-control marks

Since 0.3.0. A revision's mark is the `ControlledDocument` facet's third schema, `export_mark`,
prefix `docmark`, so every controlled type has it and no kit changes its model:

| Property                               | Written by                     | What it is                                                                                    |
| -------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| `docmark:classification`               | A holder of `ChangeExportMark` | Capitals and digits in parts joined by hyphens, 32 characters at most: `EC-2`. Empty, no mark |
| `docmark:groups`                       | With it                        | 1 to 20 groups the server has: a member of any one of them may receive the revision           |
| `docmark:markedBy`, `docmark:markedAt` | The server                     | Who last set, changed or removed the mark, and when                                           |

**Who receives a marked revision:** a member of one of its mark's groups, as the server reads their
groups: the person signed in, for a download or a rendition; each recipient, looked up in the user
directory, for a transmittal. Nobody else, an administrator included: one who must receive it is
put in a group, or changes the mark. A mark with a classification and no group, which only a write
past the add-on can leave, as an import writes, refuses everyone.

### Downloads and renditions: the platform's download permission

As the assets add-on refuses on rights ([its README](../nuxeo-agentic-assets/README.md)), the add-on
contributes a permission to `org.nuxeo.ecm.core.io.download.DownloadService`, point `permissions`,
which the platform asks before it streams a file or a rendition, and answers 403 when one refuses.
So `/nxfile/` and the REST API's `@blob`, `@rendition` and `@preview` answer 403 to anyone outside
the mark's groups, whichever client asks, and `Blob.BulkDownload` leaves the revision out of its zip.
The script only hands its globals, `Document`, `Rendition`, `Reason` and `CurrentUser`, to
`ExportMarkDownloadPermission`, inside a `try` that answers `false`: a failure, or a class that does
not load, refuses.

- **Every file and every rendition of a marked revision** is refused, its thumbnail included: a
  drawing's thumbnail shows the drawing.
- **A version or a proxy** is decided by its own mark and by its live document's, read with a
  privileged session: a version keeps the mark it had when it was made, so one made before the
  revision was marked is refused as the revision is. One whose live document cannot be read is
  refused.
- **A folder's or a collection's renditions,** but its thumbnail, are refused when the person's own
  session finds below it, or among its members, a marked controlled document, a proxy or a version
  of any controlled document, a collection, or, for a collection, a folder: the platform's
  `zipTreeExport` and container renditions hold the bytes of what they zip, and a proxy or a version
  is decided by its live document's mark, which the query cannot read. That refuses more than it
  must, never less, as the assets add-on's container rule does: a cleared reader is refused the
  folder's zip too.
- **The server's reason** is the `exportMark` document enricher's, as the assets add-on's
  `assetRights` explains a refusal: ask with `enrichers.document: exportMark`, and a controlled
  document answers its `classification`, `groups`, `markedBy`, `markedAt`, whether the reader
  `receives` it, and `reason`, `not-in-groups`, `mark-incomplete`, `holds-marked` or
  `mark-unreadable`, a code a client translates; any other document answers `null`. The enricher
  explains; the permission refuses. Each refusal is logged at `INFO`, with the document, its type,
  the use, the person and the code.

### Transmittals

A transmittal listing a marked revision goes only to recipients in one of its mark's groups
(above, "Transmittals"). The check is made last but for the number, so a refused transmittal
writes nothing and spends no number, and its refusal names each excluded recipient, the document
and the mark, which the issuer may read on the revision. The kit's Create form shows that reason,
and stays open.

### Carried to the next revision

A new revision takes the mark of the one it supersedes, its classification, groups, who and when,
as stored, whatever its creator wrote, in `aboutToCreate`, as it takes the number; an unmarked
one's next revision is unmarked. `documentCreated` checks the two marks are the same, and audits
the mark carried, on the new revision, naming the one superseded.

### Set, changed and removed: `ChangeExportMark`

The add-on's own permission, contributed to the platform's security service and shown in its
permissions screens. A first revision is marked at its creation only by a holder of it on the
folder it is created in, which the revision inherits; any later change of a mark, its removal
included, only by a holder of it on the revision; 403 otherwise, nothing written. Write is needed
besides, as for any save. Nuxeo counts `Everything` as holding every permission, and an
administrator as holding them all, so they may change a mark, audited as anyone's.

- **Checked when written:** a classification of its form; 1 to 20 groups, each a group's name, not
  `Everyone`, and each one the user directory has; or neither, for no mark. Groups alone, with no
  classification, are refused.
- **The server's two:** `docmark:markedBy` and `docmark:markedAt` are written by the server on each
  change, over whatever the save sent; a save that writes either and changes nothing else of the
  mark is refused, 400. The same mark written back with blanks or padding, as a REST client may send
  a document back, is no change: kept as stored, not audited.
- **On the revision itself:** a change through a live proxy is refused, 400, since the proxy's
  permissions are not the revision's; a version restored over a revision must carry its mark, or
  the restore is refused, 409, as for the other properties the add-on keeps.
- **Where it is decides who may change it,** since the permission is held where the revision is.
  So a marked revision goes to another folder only by a holder of `ChangeExportMark` on it and on
  that folder, 403 otherwise: its move; its next revision, created in another folder than its own;
  and the move of a folder holding one, found with a privileged query, since the move takes what the
  person may not read too. A rename in place moves nothing, and an unmarked revision, a folder
  holding none, and a next revision beside its predecessor are not asked. Who may change the
  permissions where a marked revision is, and so grant `ChangeExportMark` there, is the folders'
  `WriteSecurity`, as for any permission.

### Audited

Each mark set, changed, removed or carried is one entry in the platform's audit, the revision's
history: event `exportMarkChanged`, category `documentControl`, with the person and the extended
information `change` (`marked`, `changed`, `removed` or `carried`), `classification` and `groups`,
`previousClassification` and `previousGroups`, `carriedFrom` for a mark carried, and `by`, who acted,
and a comment in words: "Export-control mark changed from EC-2, for ec2-cleared to EC-1, for
ec1-cleared". The event is fired in the change's transaction, so a refused or failed change records
nothing, and `ExportMarkAuditWriter` writes it once the transaction has committed, in the background,
as the records add-on writes its entries, through `AuditAccess`, the records add-on's, copied.

### A change and a reading cannot cross

A new revision copies its predecessor's mark, and a transmittal checks its documents' marks, from
what each transaction read; a change of the mark committing after that read would leave a revision
carrying the mark as it was, or a transmittal sent to someone the new mark excludes. So each
revision has a **mark fence** in the key/value store, key `mark.<id>`, in the store the claims are
in, changed by compare-and-set only:

- **A new revision and a transmittal** enter the fence of each revision whose mark they read,
  adding one to its count of readers, before they first read that revision, and leave it when
  their transaction ends, whichever way. They are refused, 409, while a change holds it. A
  transmittal naming a document by its number finds its id by a projection, which reads no
  document, so the fence is entered before the revision is read.
- **A change of the mark** takes the fence from nothing, 409 otherwise, and releases it when its
  transaction ends. A transaction that holds the fence already, to read or to change it, enters it
  again at once: one that marks a revision and then supersedes it carries the new mark. What a
  transaction holds is kept with the transaction itself, read through the transaction manager, so a
  transaction begun inside another on the same thread holds none of the outer one's; and a reading
  that its own transaction turned into a change leaves nothing behind it, the change's release
  clearing the fence.
- **No way out, no way in:** the release is registered first, as for a claim, and a transaction
  where it cannot be registered is refused, 409. A server stopped mid-transaction leaves its count,
  or its change, until the claims' time to live expires: that revision's mark cannot change, or be
  read by a new revision or a transmittal, until then.

## The series

Contributed to `org.nuxeo.agentic.documents`, point `series`, by a component that requires
`org.nuxeo.agentic.documents`:

```xml
<series id="DWG" digits="5" revisions="letters" />
<series id="SPEC" digits="4" revisions="numbers" />
<series id="TR" digits="5" for="transmittals" />
```

- `id`: capitals and digits, in parts joined by single hyphens, 32 characters at most.
- `digits`: 1 to 12, the least a number's value is written with; 5 when not given.
- `revisions`: `letters` (A, B ... Z, AA, AB ...), the default, or `numbers` (1, 2, 3 ...).
- `for`: `documents`, the default, or `transmittals`. Exactly one series in force numbers
  transmittals, or a transmittal is refused, 400; a document is never numbered in it, 400.
- A series with a mistake is left out, logged as an error, so a document in it is refused. A later
  series with the same id replaces it whole, a broken one leaves none in force, and
  `enabled="false"` removes it (`SeriesRegistryTest`).

## What it does not cover yet

- **Outside users,** who will receive transmittals and comment in the portal, wait on decision C:
  here a transmittal goes to named people inside the server, and a mark's groups are the server's.
- **A mark decides the downloads the platform's download service is asked for with their
  document, and transmittals.** As for the assets add-on's rights, a blob the platform hands over
  without naming its document to that service, such as another Automation operation's result, and
  what another add-on serves from its own endpoint, are not decided here; nor is what a revision's
  metadata says, which whoever may read it reads, the banner included.
- **Review cycles do not read a mark.** A reviewer named on a marked revision's cycle reads and
  comments as the cycle's permissions allow, and is refused its files and renditions as anyone
  outside the mark's groups is.
- **A mark per revision, not per number.** A change of one revision's mark does not reach the
  others of its number: a revision already superseded keeps its own.
- **Whether a recipient or a reviewer exists.** A name is held to a user name's form, and is not
  `system`; the server does not look it up, so a transmittal to a name no one holds, or to one
  written in another case than the user directory's, waits on that receipt for ever. Nor does it
  check that a recipient may read what is sent: who may read the transmittal, its receipts and its
  documents is the folders' permissions.
- **Withdrawing a transmittal, or adding a recipient.** It is not changed once issued; a
  correction is a new transmittal. An administrator may delete one.
- **Reopening a closed cycle, or handing one over.** Only its opener resolves and closes it: one
  who leaves leaves the cycle open, which an administrator can only delete.
- **A Resolve action in the app.** The kit's cycle page lists the threads with their state; a
  thread is resolved through the comment's document, over the REST API or its own page's Edit form.
- **Reminders.** Nothing tells a recipient or a reviewer that something waits, or is late.
- **A folder's deletion by an administrator, or a bulk action's,** takes what it holds with it,
  unchecked: the guard reads the folder deleted or trashed, and the repository's own bulk paths
  may reach its contents without an event.
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
- **Nuxeo's comment manager,** `TreeCommentManager` in `nuxeo-platform-comment-2025.10.18.jar`, by
  `javap -c` on 26 November 2026, the same as 11.5.154's: `createComment` checks that the user may
  read the document commented on, then, in a privileged session opened on the user's behalf
  (`CoreInstance.doPrivileged`, so `NuxeoPrincipal.getActingUser()` is the user), creates a
  `Comment` document in the document's `Comments` folder, a `CommentRoot` it creates the first
  time, or below the comment a reply answers, with `comment:author`, `comment:parentId` and
  `comment:ancestorIds` set before `createDocument`; then saves the document commented on with the
  comment's text in its related text, adding `HasRelatedText`. The comment manager sets no
  permission on a comment, which inherits its folder's; the platform's content template gives a
  `CommentRoot` `AddChildren` and `RemoveChildren` for `members`
  (`comment-defaultPermissions-contrib.xml`), so whoever may read a cycle may add a document to its
  `Comments` folder, past the comment manager: the add-on reads where a comment is, not what it says.
  `getActingUser()` and `getOriginatingUser()` are on `NuxeoPrincipal` in both versions.
- **For 0.3.0,** on 26 November 2026, the same way, read only: the bundle's sources, the marks'
  classes among them, compile against the server's own 2025.10.18 jars in place of the 11.5 ones,
  `nuxeo-core-io`, `nuxeo-platform-usermanager` and `nuxeo-platform-audit-core` (where LTS 2025 keeps
  `AuditLogger`) besides those above. `DownloadServiceImpl.checkPermission` in
  `nuxeo-core-io-2025.10.18.jar` gives a permission's script the globals `Document`, `XPath`, `Blob`,
  `Reason`, `Infos`, `Rendition`, from the extended information `rendition`, and `CurrentUser`, as
  11.5's does; `nxserver/lib` holds `nashorn-core-15.7.jar`, the engine the tests run the script
  with. The components the marks' contribution requires are there by name:
  `org.nuxeo.ecm.core.io.download.DownloadService`, `org.nuxeo.ecm.core.io.MarshallerRegistry.marshallers`
  and `org.nuxeo.ecm.core.security.defaultPermissions`, with the security service's `permissions`
  and `permissionsVisibility` points. The audit is reached as the records add-on reaches it, which
  was checked on the same server for that add-on. The mark fence's bookkeeping is kept with the
  transaction: `TransactionHelper.lookupTransactionManager()` returns a jakarta `TransactionManager`
  there and a javax one on 11.5, so it and `getTransaction()` are called by reflection, and
  `NuxeoContainer`'s wrapper answers `getTransaction()` with Geronimo's own `TransactionImpl` from
  `geronimo-transaction-4.0.0-NX1.jar`, the thread's transaction, the same object until it ends.
  `AbstractSession.move` fires `aboutToMove` with `destinationRef` the caller's destination, `null`
  for a rename in place, and `destinationPath` the folder's.

## Building and testing it

From the repository's root, with JDK 21 and Maven:

```bash
mvn -pl nuxeo-agentic-documents -am verify
```

It runs the module's 102 tests and writes the bundle and the Marketplace package,
`nuxeo-agentic-documents/target/nuxeo-agentic-documents-0.3.0.zip`. `build-marketplace.yml` builds
and tests it on every pull request it runs for, without uploading or publishing it.

**Nuxeo's comments in the tests.** The comment manager needs relations, notifications and the user
manager, which the tests do not start. So the tests deploy Nuxeo's own `Comment` and `CommentRoot`
types, from `nuxeo-platform-comment`'s `comment-schemas-contrib.xml`, its one test dependency
with nothing of its own dependencies, and `Comments.java` writes a comment as the manager does,
above: in a privileged session on the user's behalf, in the same folder, with the same properties,
then the related text saved on the document. The steps file
(`scripts/beta-harness/steps/controlled-documents-transmittals.mjs`) writes them through the
server's own comment endpoint.

**On the Nuxeo test framework.** The tests are `FeaturesRunner` tests on `CoreFeature`: a Nuxeo
runtime, a VCS repository on H2, as the local server's, JTA transactions, and the SQL key/value
store and `KeyValueStoreUIDSequencer` configured as the local server configures them
(`src/test/resources/OSGI-INF/test-documents-contrib.xml`). Three things in `pom.xml` make 11.5's
test framework run on Java 21, for the tests only, none in the bundle: ASM 9.7, which reads Java 21
class files where 11.5's 9.0 does not; the JDK packages opened to Nuxeo Stream; and Chronicle Queue
2.25ea, where 11.5's 2.20 looks for a JDK method Java 21 removed. Chronicle publishes its open-source
builds as `ea`, and the test runtime starts it whether a test uses streams or not. A fourth,
`log4j-jcl`, takes 11.5's event service's Commons Logging to Log4j 2, where `RefusalLogTest` reads
it. Since 0.3.0, `ExportMarkTest` runs on `ExportMarksFeature`: the same runtime with the platform's
user manager and its test directories, where recipients and groups are, and the platform's audit,
its service, listener and store on H2, as the records add-on's tests run it
(`DocumentsAuditFeature`, its `RecordsAuditFeature` copied); and `nashorn-core` 15.7, the server's
engine, which the platform's download service evaluates the contributed script with. Java 21 has
none of its own.

| Test                      | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NumberingTest`           | A first revision numbered from its series, each series counting alone, the creator's own values replaced, blanks and padding included, no series or an unknown one refused, the facet refused when added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `SupersessionTest`        | The number and next revision taken, the old one superseded both ways; refused for a superseded, trashed, other-typed, missing or version predecessor; refused without write, and without read, with nothing written; atomic when the old one's write fails, when a caller catches the refusal, and when the caller's transaction fails later; the claim released each time; no claim in a transaction marked for rollback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ConcurrencyTest`         | Many threads at once, each creation in its own transaction (below); and 16 revisions of one at once, of which one wins and every other is refused as a conflict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GuardTest`               | No save changes a `docctl:` property, an administrator's included, padded with spaces included, nor marks a revision superseded by hand, nor writes through a live proxy; the facet not added; no copy; no restore that would change them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `RefusalLogTest`          | A refusal not logged by the event service as an error; an unforeseen failure still logged as one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `NumberSeriesTest`        | Numbers, series ids, digits, revisions, document ids                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `SeriesRegistryTest`      | Series replaced, broken and removed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `BundleTest`              | The manifest's six components, the service, every facet and its schema the runtime registers, the mark's schema among them, the series for transmittals, and the package's version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `TransmittalTest`         | Issued with each document at its current revision, numbered, a receipt per recipient; the issuer's own values replaced; every check of what it says, with nothing written and no number spent when refused; what the issuer may not read refused; a receipt the server's alone; answered once, by its recipient, and the server says when; a return says why; the answer refused to anyone else, the issuer, another user who may write it and an administrator; the platform's refusal to a recipient who may not write; nothing else of a receipt or a transmittal changed; kept, not copied, not restored to awaiting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ReviewCycleTest`         | Opened on a current revision its opener may write, one at a time; a reviewer's comment an open thread, a reply part of it, a comment elsewhere left alone; only the reviewers and the opener comment; only the opener resolves, closes, and the server writes who and when; a cycle with an open thread not closed; a closed cycle recorded on the revision; nothing of a closed cycle or its comments changed, not even through a privileged session on a user's behalf; the revision's record the server's, an administrator's write refused; the facet the server's; past the claim's and the fence's time, the cycles' own status still refusing; a comment written as a plain document the cycle's by where it is, its author and parents the server's; a comment's words its author's; a thread deleted by its author alone, not with its replies, nor its folder; nothing moved in or out, its Comments folder included, and a comment trashed by its author through the trash's rename in place; a comment elsewhere never naming a cycle; an open cycle trashed still holding its revision; a caller that catches a refusal unable to commit; `system` no one's name                                                                                                                                                                                                                                                                                                                      |
| `WorkflowConcurrencyTest` | 16 recipients answering at once, each kept; one receipt answered 16 times at once, one answer taken and 15 refused as conflicts; 16 cycles opened on one revision at once, one opened; the fence held open on purpose, by a comment's transaction and then by a close's, each refusing the other until it ends; and 8 rounds of 6 reviewers commenting while the opener closes, after which no closed cycle holds an open comment, and every close and comment either went through or was refused as a conflict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ExportMarkTest`          | A marked revision's file, at its place and its blob holder's, for a download, a preview and a view, and each rendition, refused through the platform's download service to anyone outside its groups, an administrator included, and served to a member; a version made before the mark, and a proxy of it, by the live document's mark, and the folder holding that proxy refused its zip; a folder holding a marked revision refused its renditions but its thumbnail, as the reader's own session finds it; a marked revision, a folder holding one and a next revision in another folder going elsewhere only with the permission on it and where it goes, a rename in place let through; the enricher's reason; a transmittal refused, naming who and what, with nothing written and no number spent, a name no user holds and an administrator included, and issued to members; the mark carried to a new revision, whatever its creator wrote; a change and a removal refused without `ChangeExportMark`, a new revision marked where it is not held, a mark of the wrong form, with no group, `Everyone`, a group the server lacks, who and when written, a change through a proxy and a restore refused, padding no change; an administrator's change; each change and a mark carried audited, a refused one not; the mark fence held open on purpose, by a new revision's transaction and then by a change's, each refusing the other until it ends; the permission registered and shown |

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
build unbroken was green: values compared trimmed; a blank `docctl:supersedes` kept on a first
revision; a claim taken where no release could be registered; a refusal thrown as a plain
`NuxeoException`; numbers from a constant; the creator's status kept; the write check
removed (the platform's own `WriteProperties` refusal still came, without the add-on's message);
the rollback mark removed (a caller that caught the refusal committed the new revision alone); no
claim (16 of 16 revisions created over one); a claim not released, or released only on commit; the
guard off; the supersession's token not checked; a copy allowed; a folder's contents looked for as
the user; any restore allowed; the facet allowed on a saved document, or on a new one; another type,
a trashed, a version or a superseded predecessor allowed (the last still refused, by the claim
committed a moment before); the creator's text written back; any text a series id; a number without
its hyphen; the letters miscounted; the manifest's version moved; the listener not told of
creations; a broken series leaving an earlier one in force.

**And 0.2.0's, the 48 guards of transmittals and review cycles,** each broken one at a time, each
turned its test red, and the build unbroken was green: a non-recipient's answer let through; a
receipt answered twice; no claim on an answer; a client's receipt let through; a transmittal changed
after it is issued; a superseded revision sent; a return with no comment; a receipt deleted by
anyone; a folder holding what the add-on keeps deleted, or a document that is no folder looked below
for none; the creator's issuer kept; the number taken before the checks (a refused transmittal spent
one); a cycle closed with an open comment; a cycle closed by anyone; a comment resolved by anyone;
a comment by anyone; a comment's cycle read from what it says rather than where it is; a forged
author kept; a comment elsewhere naming the cycle let through, by its parent or by its ancestors,
written so or changed so later; a comment's author changed; anyone's words changed; an open thread
deleted by anyone, or with its replies; something moved into a cycle, a cycle's comment out of it,
or its Comments folder; a rename in place taken for a move; a trashed open cycle releasing its
revision; no claim on opening; no query for an open cycle (seen once the claim expires); the claim kept after the close;
a closed cycle not recorded; a closed cycle's comment changed, a comment written in one, and one
deleted, each once the fence expires; a superseded revision reviewed; a cycle opened without write;
the review record written by anyone; a creator's review record kept; a transmittal or a cycle
copied; a version restored over an answered receipt; a privileged session on a user's behalf taken
for an administrator; no rollback mark on a refusal (a caller that caught one committed a second
open cycle); `system` taken for a name; and the fence never taken by a close, or never refusing a
comment while closing, each caught both by the fence held on purpose and by the race of comments
and a close.

**And 0.3.0's, the 31 guards of export-control marks,** each broken one at a time, each turned
`ExportMarkTest` red, and the build unbroken was green: anyone in a group taken as receiving; an
administrator exempt; the script letting everything through; a version decided by its own mark
alone; no container refused; a container's thumbnail refused too; a transmittal not held to marks;
a name no user holds let through; the mark not carried; the creator's mark kept on a new revision; a
change without the permission; a new revision marked without it; who and when written by a client;
`Everyone` taken for a group; a group the server lacks let through; a change not audited; a carried
mark not audited; the audit writer writing nothing; a change taking no fence; a new revision, or a
transmittal, entering none; the fence not re-entrant (a transaction that marked a revision could
not then supersede it); a restore changing the mark; a change through a proxy; padding taken for a
change; the enricher saying everyone receives; and, found by the independent review before the
pull request and added with their tests, a marked revision moved anywhere, a folder holding one
moved anywhere, a next revision created in any folder, a proxy of an older version in a folder
not counting for its zip, and a rename with no destination refused.

**What the tests cannot reach:** a server whose key/value store is MongoDB, or PostgreSQL, rather
than H2; the jakarta half of the synchronization lookup, which only the server has; Nuxeo's comment
manager itself, whose writes `Comments.java` repeats; LTS 2025's audit service, which the tests'
11.5 platform does not have, and its download servlet's answer: the tests ask the download service
itself, `checkPermission`, which `/nxfile/` and the REST API ask before they stream, and no HTTP
request is made; and REST clients: the listeners see `CoreSession`, which every endpoint goes
through. The steps files make them, once installed.

## Installing it on a local Nuxeo

**Not run.** The orchestrator installs. The local Nuxeo is the Docker container `nuxeo`, on port
8080; `nuxeoctl mp-install` refuses while the server runs, so a one-off script installs it when
the container next starts, as the assets add-on's README does. Install it with the controlled
documents kit, which depends on it, in one restart. Over 0.1.0, which the local server has with the
kit's 0.1.0, the same commands upgrade both: `mp-install` removes the version before. 0.2.0 adds
schemas, facets, a schema to `ControlledDocument` and two listeners; 0.3.0 adds a third schema to
`ControlledDocument`, a permission, a download permission, an enricher and an audit writer. Neither
removes anything, so no document needs deleting first; the documents numbered under 0.1.0 keep their
numbers, unmarked.

```bash
mvn -pl nuxeo-agentic-documents -am package
npm run app-package -- business-apps/packages/controlled-documents-demo --platform 0.2.0
docker cp nuxeo-agentic-documents/target/nuxeo-agentic-documents-0.3.0.zip nuxeo:/tmp/
docker cp business-apps/packages/controlled-documents-demo/dist/controlled-documents-demo-0.3.0.zip nuxeo:/tmp/
```

```bash
printf '%s\n' '#!/bin/bash' 'nuxeoctl mp-install /tmp/nuxeo-agentic-documents-0.3.0.zip /tmp/controlled-documents-demo-0.3.0.zip --accept=true > /var/log/nuxeo/documents-install.log 2>&1 || echo "documents: install failed, see /var/log/nuxeo/documents-install.log"' 'rm -f "$0"' > /tmp/zz-documents-install.sh && chmod 755 /tmp/zz-documents-install.sh
docker cp /tmp/zz-documents-install.sh nuxeo:/docker-entrypoint-initnuxeo.d/ && docker restart nuxeo
```

Then, once `http://localhost:8080/nuxeo/runningstatus` answers 200: the install log lists both
packages at 0.3.0; the server log's `Component Loading Status` names `org.nuxeo.agentic.documents`,
`org.nuxeo.agentic.documents.schema`, `org.nuxeo.agentic.documents.listener`,
`org.nuxeo.agentic.documents.transmittals`, `org.nuxeo.agentic.documents.reviews`,
`org.nuxeo.agentic.documents.marks` and `nuxeo.config.controlled-documents-demo.series`, with
nothing pending; it has no `Controlled documents:` error; `GET /nuxeo/api/v1/config/types/Transmittal`
and `GET /nuxeo/api/v1/config/schemas/export_mark` answer 200; and the kit's seed runs (its
README). To remove both:
`nuxeoctl mp-remove controlled-documents-demo nuxeo-agentic-documents --accept=true`, the kit first.
Documents of the kit's types must be deleted first, by an administrator for transmittals, receipts
and review cycles: one whose type is gone cannot be read.

## For the security review

The plan requires one before this is relied on, deferred until the app is finished
([security-reviews.md](../docs/business-apps/security-reviews.md)). What it is to check, and no
finding: a review's findings are kept outside this repository. For numbering and supersession:

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
   the folder's id written into it after a check of its form. Its refusal tells the user that such
   documents are below the folder, ones they may not read included.
8. **The cost:** one listener on six events for every document, which reads only a facet for a
   document that is not controlled, and one query per copy of a folder.

For transmittals and review cycles, since 0.2.0:

9. **Who acts.** Each check reads `NuxeoPrincipal.getActingUser()`: the user, or the one a
   privileged session acts for. That every path that writes a comment, a receipt or a cycle on a
   user's behalf opens its privileged session with that user as its originating user, as the
   comment manager does, and none with another's; and that `Refusal.isAdministrator` refuses the
   platform's administrator status to such a session.
10. **What a recipient and a reviewer may see.** The server does not grant anyone anything: who may
    read a transmittal, its receipts, its documents and a review cycle is the folders'
    permissions. Whether a transmittal should refuse a recipient who may not read what it sends,
    and whether a receipt, which repeats the transmittal's number, subject, purpose, due day and
    issuer, says more than its recipient may read.
11. **Names not checked.** Recipients and reviewers are held to a user name's form and not looked
    up; a name no user holds, or a group's name, is taken as it is.
12. **The number lookup.** An entry of `trm:documents` that has a number's form, of a registered
    series, is written into a query run as the issuer, after the check of its form; any other is
    looked up as an id.
13. **The receipt's creation and the review record.** Told apart from a client's by
    `ServerWrite`'s objects, by identity, in the document's context data, as the supersession is;
    that nothing a client sends can be one.
14. **The claims and the fence.** Their keys, `receipt.<id>`, `review.<revision id>` and
    `cycle.<id>`, in the same store as the supersession claims; their release on every outcome; a
    stopped server's leftovers, which block an answer, a cycle's opening, a comment or a close
    until they expire; and whether an administrator needs a way to clear one.
15. **What is kept.** Deletion and trash of transmittals, receipts, cycles, a closed cycle's
    comments, and any document holding one of them, are an administrator's alone; an open cycle's
    comment is its author's to delete, when it has no replies. Copies are refused, and restores
    that would change them. Whether every path that removes or trashes many documents, a bulk
    action's among them, fires an event this sees for the topmost.
16. **The comments.** A comment written directly as a document, past the comment manager, by
    whoever may add children to a cycle's `Comments` folder: that where it is, read from its
    folders, makes it the cycle's, held to the same checks, its author and parents written by the
    server; that nothing reaches a cycle's subtree but by creation there, a move by an
    administrator, an import, or server code; and that the platform's own paths that list a
    document's comments, by `ecm:parentId` and by `comment:ancestorIds`, agree with the add-on's.
17. **The cost:** two more listeners on every document's creation, save, deletion and trash, and
    on its move. For a document without their facets and without Nuxeo's `comment` schema, each
    reads facets only, but for a deletion or trash, which asks whether it has children and, if it
    has, queries below it once, and a move, which reads its folders. A comment anywhere costs a
    privileged read of its folders and of each document it names, 17 at most.

For export-control marks, since 0.3.0:

18. **Every path that hands over a marked revision's bytes:** which call the platform's download
    service with the document, so the permission decides them, `/nxfile/`, `@blob`, `@rendition`,
    `@preview`, `Blob.BulkDownload` and CMIS's content stream, as the assets add-on read them; which
    do not, as Automation operations that return a blob or a conversion of it, the REST API's
    `@convert`, and what other add-ons serve; WebDAV and Nuxeo Drive among those to read; and whether
    those must be closed for a mark, beyond what the assets add-on's review settles for rights.
19. **Who is the person a download is decided for:** the download service's `CurrentUser`, and,
    for a privileged session acting for someone, the originating user's groups, looked up; that no
    path decides a download for the system or another person.
20. **Group membership as the server reads it:** `NuxeoPrincipal.getAllGroups()`, with sub-groups,
    for the person signed in and for each recipient, looked up in the user directory with a
    privileged call; a name no user holds, in no group; a group deleted after a revision was marked,
    which then admits no one of that name until it is made again.
21. **Where a marked revision is:** a move, a next revision in another folder and a folder's move
    held to `ChangeExportMark` on the revision and where it goes; every other path that changes where a
    revision is, or the permissions there, `WriteSecurity` granting `ChangeExportMark` among them, and
    whether any of them reaches a mark past that check.
22. **The permission:** `ChangeExportMark`, held by `Everything` and by every administrator as the
    platform counts them; who should hold it, on which folders; whether a mark should be set or
    changed only by a group the server names, and whether a creator should mark a first revision.
23. **What the refusals say:** a transmittal's names the excluded recipients, the document and its
    mark's groups, which the issuer may read on the revision, and tells them who is in no group of
    it; the enricher's tells a reader the mark of a revision they may read. Whether a refusal says
    more than its reader may know.
24. **The mark fence:** its key, `mark.<id>`, beside the claims; its release on every outcome; its
    re-entry within a transaction, kept with the transaction the transaction manager names; a
    stopped server's leftover, which blocks a change or a reading until it expires.
25. **Containers:** the container query, run as the reader, by `ecm:ancestorId` and
    `collectionMember:collectionIds`, with the id checked before it is written into it; that it
    counts any proxy or version of a controlled document, and refuses a cleared reader's zip of a
    folder too; that `ecm:mixinType` and `ecm:isProxy` match a proxy there on PostgreSQL and MongoDB
    as on the tests' H2.
26. **The audit:** that every change and carrying writes an entry after its commit, and none for a
    refused change; that the audit's own retention keeps them as long as a mark's history must be
    kept.
27. **The cost:** the download permission's script on every download, which reads only facets for a
    document that is not controlled and not a folder, and one query for a folder's or collection's
    rendition; a transmittal's lookup of each recipient, and one key/value write per listed
    revision; a revision's fence on its creation and on a change of its mark; a privileged query
    for a folder's move.
