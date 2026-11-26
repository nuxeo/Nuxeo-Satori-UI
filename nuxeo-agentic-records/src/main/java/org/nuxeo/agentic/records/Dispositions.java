package org.nuxeo.agentic.records;

import static org.nuxeo.agentic.records.Disposition.*;

import java.io.Serializable;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.UUID;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.cluster.ClusterService;
import org.nuxeo.runtime.kv.KeyValueService;
import org.nuxeo.runtime.kv.KeyValueStore;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * What a person's request does: a run started, a run approved or rejected, a run disposed of.
 *
 * <h2>Who</h2>
 * Each request is checked with the person's own permissions, the ones the add-on defines, on the
 * repository's one {@code DispositionRuns} folder, which must block every permission it would
 * inherit. A run is disposed of once {@value Disposition#APPROVALS_REQUIRED} different people with
 * {@code ApproveDisposition} have approved it, none of them its starter. Names are compared without
 * their case, as {@code LayerService} compares an approver with a draft's makers.
 *
 * <h2>One at a time, each in a transaction of its own</h2>
 * Every request is handled inside one lock: the server's, and in a cluster the cluster's, an entry
 * of the cluster's key-value store ({@link #CLUSTER}), as {@code LayerService} makes its changes
 * inside the server's and the cluster's locks. Inside it, the request runs in a transaction
 * of its own, which reads the runs as the last request left them and is committed before the lock is
 * given back. So two approvals at once are taken one after the other: one person's second is refused
 * as theirs, and a run's second approval disposes of it once. A refusal writes nothing. A failure
 * while disposing rolls that transaction back whole, the records deleted so far included, so a run is
 * disposed of whole, with its certificate, or not at all.
 *
 * <p>
 * The request document itself is written afterwards, by the person's own transaction, with what came
 * of it. Should that transaction fail after the request's own committed, the run keeps what the
 * request did, and the request document is missing: the run, not the request, is the record of
 * what was decided.
 */
final class Dispositions {

    private static final Logger log = LogManager.getLogger(Dispositions.class);

    /** Runs the work alone: on this server, and across a cluster. */
    interface Lock {

        void run(Runnable work);
    }

    private static final Object SERVER = new Object();

    /** The cluster's key-value store, which the cluster service keeps its own locks in. */
    static final String CLUSTER_STORE = "cluster";

    /** How long a server waits for another's lock, and how often it tries. */
    static final Duration WAIT = Duration.ofSeconds(30);

    static final Duration POLL = Duration.ofMillis(100);

    /**
     * How long a lock is held at most, should its server stop holding it: longer than a transaction
     * may last, so that no request outlives its lock.
     */
    static final Duration HOLD = Duration.ofMinutes(10);

    /**
     * The server's lock, then, in a cluster, the cluster's: an entry in the cluster's key-value store,
     * set only when it is free, which another server waits for. Not {@code ClusterService.runAtomically}:
     * in a cluster that commits the caller's transaction before it runs the work, and the person's
     * transaction is the request's, to be rolled back whole when the request is refused.
     */
    static final Lock CLUSTER = work -> {
        synchronized (SERVER) {
            ClusterService cluster = Framework.getService(ClusterService.class);
            if (cluster == null || !cluster.isEnabled()) {
                work.run();
                return;
            }
            KeyValueStore store = Framework.getService(KeyValueService.class).getKeyValueStore(CLUSTER_STORE);
            String owner = cluster.getNodeId() + "/" + UUID.randomUUID();
            long deadline = System.nanoTime() + WAIT.toNanos();
            while (!store.compareAndSet(LOCK_KEY, null, owner, HOLD.toSeconds())) {
                if (System.nanoTime() > deadline) {
                    throw new DispositionRefusal(409, "busy",
                            "Another server is taking a disposition request: file this one again.");
                }
                try {
                    Thread.sleep(POLL.toMillis());
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new DispositionRefusal(409, "busy", "The request was interrupted before it was taken.");
                }
            }
            try {
                work.run();
            } finally {
                try {
                    store.compareAndSet(LOCK_KEY, owner, null);
                } catch (RuntimeException e) {
                    // The request's own transaction has committed, or rolled back, already: what it
                    // did stands, and the lock is given back when its hold ends.
                    log.warn("Disposition review: the cluster's lock could not be given back, and is held until it "
                            + "expires: {}", e.toString());
                }
            }
        }
    };

    /** What a request came to: the run's state after it, and the run. */
    record Outcome(String outcome, String runId, long runNumber) {
    }

    private final Clock clock;

    private final Lock lock;

    Dispositions(Clock clock, Lock lock) {
        this.clock = clock;
        this.lock = lock;
    }

    // --- The folder ---------------------------------------------------------------------------------

    /**
     * A new {@code DispositionRuns} folder: an administrator's, at the repository's root, and only one
     * per repository. At the root, as the retention module keeps its rules, so that no one but an
     * administrator can delete, trash, move or copy a folder above it: the repository removes a
     * folder's contents with no event of their own, so the add-on's guard sees only what is removed
     * itself.
     */
    void folderCreated(CoreSession session, DocumentModel folder) {
        if (!session.getPrincipal().isAdministrator()) {
            throw new DispositionRefusal(403, "administrators-only",
                    "Only an administrator makes the repository's disposition runs folder.");
        }
        CoreInstance.doPrivileged(session, (CoreSession privileged) -> {
            if (!atRoot(privileged, folder.getParentRef())) {
                throw new DispositionRefusal(400, "not-at-root",
                        "The disposition runs folder is made at the repository's root, where no one but an administrator removes or copies what holds it.");
            }
            if (folders(privileged) > 0) {
                throw new DispositionRefusal(409, "folder-exists",
                        "The repository has its disposition runs folder already: there is one, so that no run misses another's records.");
            }
        });
        folder.setPropertyValue(SEQUENCE, 0L);
    }

    /** Whether {@code parent}, by id or by path, is the repository's root. */
    static boolean atRoot(CoreSession privileged, DocumentRef parent) {
        return parent != null && privileged.exists(parent)
                && privileged.getDocument(parent).getId().equals(privileged.getRootDocument().getId());
    }

    /** How many {@code DispositionRuns} folders the repository has, the trashed ones counted. */
    private static long folders(CoreSession privileged) {
        return count(privileged, RUNS_TYPE);
    }

    /** How many live documents of {@code type} the repository has, the trashed ones counted: 0, 1, or 2 for more. */
    static long count(CoreSession privileged, String type) {
        return privileged.query("SELECT * FROM " + type + " WHERE ecm:isProxy = 0 AND ecm:isVersion = 0", null, 2, 0, false)
                         .size();
    }

    // --- A request filed ----------------------------------------------------------------------------

    /** Handles {@code request}, filed by the person of {@code session}, and fills in what came of it; or refuses it. */
    void file(CoreSession session, DocumentModel request) {
        NuxeoPrincipal person = person(session);
        String action = text(request, REQUEST_ACTION);
        String runId = text(request, REQUEST_RUN);
        String comment = text(request, REQUEST_COMMENT);
        if (!START.equals(action) && !APPROVE.equals(action) && !REJECT.equals(action)) {
            throw new DispositionRefusal(400, "bad-request",
                    "A request's action, dreq:action, is \"start\", \"approve\" or \"reject\".");
        }
        if (!START.equals(action) && !DueRecords.ID.matcher(runId).matches()) {
            throw new DispositionRefusal(400, "bad-request", "A request to approve or reject names its run's id, dreq:run.");
        }
        if (comment.length() > MAX_COMMENT) {
            throw new DispositionRefusal(400, "bad-request", "A request's comment is at most " + MAX_COMMENT + " characters.");
        }
        DocumentRef folderRef = request.getParentRef();
        String repository = session.getRepositoryName();
        Outcome[] outcome = new Outcome[1];
        RuntimeException[] failed = new RuntimeException[1];
        lock.run(() -> {
            try {
                outcome[0] = TransactionHelper.runInNewTransaction(
                        () -> CoreInstance.doPrivileged(repository, (CoreSession privileged) -> {
                            CoreSession as = CoreInstance.getCoreSession(repository, person);
                            DocumentModel folder = folderOf(privileged, folderRef);
                            Instant now = clock.instant();
                            return START.equals(action) ? start(as, privileged, folder, person, now)
                                    : decide(as, privileged, folder, person, action, runId, now);
                        }));
            } catch (RuntimeException e) {
                failed[0] = e;
            }
        });
        if (failed[0] != null) {
            throw failed[0];
        }
        Outcome done = outcome[0];
        request.setPropertyValue(TITLE, switch (action) {
        case START -> "Start of disposition run " + done.runNumber();
        case APPROVE -> "Approval of disposition run " + done.runNumber();
        default -> "Rejection of disposition run " + done.runNumber();
        } + " by " + person.getName());
        request.setPropertyValue(REQUEST_ACTION, action);
        request.setPropertyValue(REQUEST_RUN, done.runId());
        request.setPropertyValue(REQUEST_RUN_NUMBER, done.runNumber());
        request.setPropertyValue(REQUEST_COMMENT, comment.isEmpty() ? null : comment);
        request.setPropertyValue(REQUEST_BY, person.getName());
        request.setPropertyValue(REQUEST_AT, calendar(clock.instant()));
        request.setPropertyValue(REQUEST_OUTCOME, done.outcome());
    }

    // --- A run started ------------------------------------------------------------------------------

    /** A new run holding the records due that {@code as}, its starter, may read; or a refusal. */
    private static Outcome start(CoreSession as, CoreSession privileged, DocumentModel folder, NuxeoPrincipal starter,
            Instant now) {
        if (!as.hasPermission(folder.getRef(), START_PERMISSION)) {
            throw new DispositionRefusal(403, "permission",
                    "Starting a disposition run needs the StartDisposition permission on the disposition runs folder.");
        }
        int max = maxRecords();
        List<DueRecords.Due> due = DueRecords.find(as, privileged, heldByOpenRuns(privileged), max, now);
        if (due.isEmpty()) {
            throw new DispositionRefusal(409, "nothing-due",
                    "No record you may read is due for disposition: none whose retention has ended, under no hold and in no other run.");
        }
        long number = longValue(folder.getPropertyValue(SEQUENCE)) + 1;
        folder.setPropertyValue(SEQUENCE, number);
        ServiceWrites.run(() -> privileged.saveDocument(folder));

        List<Map<String, Serializable>> records = new ArrayList<>();
        for (DueRecords.Due record : due) {
            records.add(row(record, AWAITING, null));
        }
        DocumentModel run = privileged.createDocumentModel(folder.getPathAsString(), "run-" + number, RUN_TYPE);
        run.setPropertyValue(TITLE, "Disposition run " + number);
        run.setPropertyValue(RUN_NUMBER, number);
        run.setPropertyValue(RUN_STATE, PENDING);
        run.setPropertyValue(RUN_STARTED_BY, starter.getName());
        run.setPropertyValue(RUN_STARTED_AT, calendar(now));
        run.setPropertyValue(RUN_RECORD_COUNT, (long) records.size());
        run.setPropertyValue(RUN_RECORDS, (Serializable) records);
        DocumentModel created = ServiceWrites.run(() -> privileged.createDocument(run));
        RecordsAudit.run(RecordsAudit.RUN_STARTED, privileged, starter, subjects(records),
                runInfo(created.getId(), number), "Held in disposition run " + number + ", started by " + starter.getName());
        log.info("Disposition run {} started by {}, holding {} record(s){}", number, printable(starter.getName()),
                records.size(), due.size() >= max ? ", the most a run holds" : "");
        return new Outcome(STARTED, created.getId(), number);
    }

    /** The records the runs still awaiting approval hold, so that no record is in two. */
    private static Set<String> heldByOpenRuns(CoreSession privileged) {
        Set<String> held = new HashSet<>();
        for (DocumentModel open : privileged.query("SELECT * FROM " + RUN_TYPE + " WHERE " + RUN_STATE + " = '"
                + PENDING + "' AND ecm:isProxy = 0 AND ecm:isVersion = 0")) {
            for (Map<String, Serializable> record : records(open)) {
                if (record.get("uid") instanceof String uid) {
                    held.add(uid);
                }
            }
        }
        return held;
    }

    // --- A run approved or rejected -----------------------------------------------------------------

    private Outcome decide(CoreSession as, CoreSession privileged, DocumentModel folder, NuxeoPrincipal person,
            String action, String runId, Instant now) {
        String name = person.getName();
        IdRef ref = new IdRef(runId);
        DocumentModel run = privileged.exists(ref) ? privileged.getDocument(ref) : null;
        if (run == null || !RUN_TYPE.equals(run.getType()) || run.isProxy() || run.isVersion()
                || !folder.getRef().equals(run.getParentRef())) {
            throw new DispositionRefusal(404, "no-run", "The request names no disposition run of this folder.");
        }
        boolean approver = as.hasPermission(ref, APPROVE_PERMISSION);
        // The starter withdraws their own run; anyone else who rejects one is an approver.
        boolean starter = name.equalsIgnoreCase(String.valueOf(run.getPropertyValue(RUN_STARTED_BY)))
                && as.hasPermission(ref, START_PERMISSION);
        if (APPROVE.equals(action) && !approver || REJECT.equals(action) && !approver && !starter) {
            throw new DispositionRefusal(403, "permission", APPROVE.equals(action)
                    ? "Approving a disposition run needs the ApproveDisposition permission."
                    : "Rejecting a disposition run needs the ApproveDisposition permission, or to be its starter with StartDisposition.");
        }
        long number = longValue(run.getPropertyValue(RUN_NUMBER));
        String state = String.valueOf(run.getPropertyValue(RUN_STATE));
        if (!PENDING.equals(state)) {
            throw new DispositionRefusal(409, "not-pending", "The run is " + state + ": it awaits no decision.");
        }
        String outcome;
        if (APPROVE.equals(action)) {
            if (name.equalsIgnoreCase(String.valueOf(run.getPropertyValue(RUN_STARTED_BY)))) {
                throw new DispositionRefusal(403, "self-approval", "You started this run, so two other people approve it.");
            }
            List<Map<String, Serializable>> approvals = approvals(run);
            for (Map<String, Serializable> approval : approvals) {
                if (name.equalsIgnoreCase(String.valueOf(approval.get("by")))) {
                    throw new DispositionRefusal(409, "already-approved",
                            "You have approved this run already: a second person approves it.");
                }
            }
            Map<String, Serializable> approval = new LinkedHashMap<>();
            approval.put("by", name);
            approval.put("at", calendar(now));
            approvals.add(approval);
            run.setPropertyValue(RUN_APPROVALS, (Serializable) approvals);
            Map<String, Serializable> approved = runInfo(run.getId(), number);
            approved.put(RecordsAudit.APPROVAL, (long) approvals.size());
            RecordsAudit.run(RecordsAudit.RUN_APPROVED, privileged, person, subjects(records(run)), approved,
                    "Disposition run " + number + " approved by " + name + ", approval " + approvals.size() + " of "
                            + APPROVALS_REQUIRED);
            outcome = approvals.size() >= APPROVALS_REQUIRED ? dispose(privileged, folder, run, person, now) : APPROVED;
        } else {
            List<Map<String, Serializable>> records = records(run);
            for (Map<String, Serializable> record : records) {
                record.put("status", KEPT);
            }
            run.setPropertyValue(RUN_RECORDS, (Serializable) records);
            close(run, REJECTED, name, now);
            boolean withdrawn = name.equalsIgnoreCase(String.valueOf(run.getPropertyValue(RUN_STARTED_BY)));
            RecordsAudit.run(RecordsAudit.RUN_REJECTED, privileged, person, subjects(records), runInfo(run.getId(), number),
                    "Disposition run " + number + (withdrawn ? " withdrawn by its starter, " : " rejected by ") + name
                            + ": the record is kept");
            outcome = REJECTED;
        }
        ServiceWrites.run(() -> privileged.saveDocument(run));
        log.info("Disposition run {}: {} by {}, now {}", number, action, printable(name), outcome);
        return new Outcome(outcome, run.getId(), number);
    }

    // --- A run disposed of --------------------------------------------------------------------------

    /**
     * Disposes of every record of {@code run}, or of none: each is checked again first, and if any
     * may no longer be disposed of, the run is halted and nothing is deleted. Then each is deleted,
     * and the certificate written. A failure on the way throws, and the transaction is rolled back.
     */
    private String dispose(CoreSession privileged, DocumentModel folder, DocumentModel run, NuxeoPrincipal person,
            Instant now) {
        String by = person.getName();
        long number = longValue(run.getPropertyValue(RUN_NUMBER));
        List<Map<String, Serializable>> records = records(run);
        List<DueRecords.Due> current = new ArrayList<>();
        Map<String, String> refused = new LinkedHashMap<>();
        for (Map<String, Serializable> record : records) {
            String uid = String.valueOf(record.get("uid"));
            IdRef ref = new IdRef(uid);
            String why;
            DocumentModel doc = null;
            if (!DueRecords.ID.matcher(uid).matches() || !privileged.exists(ref)) {
                why = "no longer exists";
            } else {
                doc = privileged.getDocument(ref);
                why = DueRecords.why(doc, privileged, now);
                if (why == null && !String.valueOf(record.get("ruleId")).equals(DueRecords.ruleId(doc))) {
                    why = "has another retention rule than when the run started";
                }
                if (why == null && !DueRecords.sameDisposal(record, DueRecords.of(doc, privileged))) {
                    why = "has another disposition action than when the run started";
                }
            }
            if (why != null) {
                refused.put(uid, why);
            } else {
                current.add(DueRecords.of(doc, privileged));
            }
        }
        if (!refused.isEmpty()) {
            for (Map<String, Serializable> record : records) {
                String why = refused.get(String.valueOf(record.get("uid")));
                record.put("status", why == null ? KEPT : REFUSED);
                record.put("reason", why == null ? null : "It " + why + ".");
            }
            run.setPropertyValue(RUN_RECORDS, (Serializable) records);
            run.setPropertyValue(RUN_HALT_REASON, refused.size() + " of the run's " + records.size()
                    + " records may no longer be disposed of, so nothing was disposed of.");
            close(run, HALTED, by, now);
            for (Map<String, Serializable> record : records) {
                Map<String, Serializable> halted = runInfo(run.getId(), number);
                halted.put(RecordsAudit.STATUS, String.valueOf(record.get("status")));
                if (record.get("reason") != null) {
                    halted.put(RecordsAudit.REASON, String.valueOf(record.get("reason")));
                }
                RecordsAudit.run(RecordsAudit.RUN_HALTED, privileged, person, subjects(List.of(record)), halted,
                        "Disposition run " + number + " halted at its second approval, by " + by
                                + (record.get("reason") == null ? ": nothing was disposed of" : ": " + record.get("reason")));
            }
            log.warn("Disposition run {} halted at its second approval: {} record(s) may no longer be disposed of",
                    longValue(run.getPropertyValue(RUN_NUMBER)), refused.size());
            return HALTED;
        }

        // Deleted, permanently. The repository itself refuses to delete a record under retention or a
        // legal hold, whoever asks: a second check, below this add-on's. A physical record is not
        // deleted: its destruction or transfer is recorded on it, once the certificate is written.
        for (DueRecords.Due record : current) {
            if (!record.physical()) {
                privileged.removeDocument(new IdRef(record.uid()));
            }
        }
        // Each record's own entry, by its path and id as the run kept them: the platform logs the
        // deletion itself as the add-on's system session's.
        Calendar disposedAt = calendar(now);
        Map<String, DueRecords.Due> byUid = new HashMap<>();
        current.forEach(record -> byUid.put(record.uid(), record));
        List<Map<String, Serializable>> updated = new ArrayList<>();
        for (Map<String, Serializable> record : records) {
            updated.add(row(byUid.get(String.valueOf(record.get("uid"))), DISPOSED, null));
        }
        run.setPropertyValue(RUN_RECORDS, (Serializable) updated);
        DocumentModel certificate = certificate(privileged, folder, run, current, disposedAt);
        run.setPropertyValue(RUN_CERTIFICATE, certificate.getId());
        run.setPropertyValue(RUN_CERTIFICATE_SHA256, certificate.getPropertyValue(CERT_SHA256));
        close(run, DISPOSED, by, now);
        Map<String, Serializable> disposed = runInfo(run.getId(), number);
        disposed.put(RecordsAudit.CERTIFICATE_UID, certificate.getId());
        disposed.put(RecordsAudit.CERTIFICATE_SHA256, String.valueOf(certificate.getPropertyValue(CERT_SHA256)));
        disposed.put(RecordsAudit.STARTED_BY, String.valueOf(run.getPropertyValue(RUN_STARTED_BY)));
        List<String> approvers = new ArrayList<>();
        for (Map<String, Serializable> approval : approvals(run)) {
            approvers.add(String.valueOf(approval.get("by")));
        }
        disposed.put(RecordsAudit.APPROVED_BY, String.join(", ", approvers));
        List<RecordsAudit.Subject> gone = new ArrayList<>();
        for (DueRecords.Due record : current) {
            if (!record.physical()) {
                gone.add(new RecordsAudit.Subject(record.uid(), record.path(), record.type()));
            }
        }
        RecordsAudit.run(RecordsAudit.RECORD_DISPOSED, privileged, person, gone, disposed,
                "Disposed of in disposition run " + number + ", deleted permanently; approved by "
                        + String.join(" and ", approvers) + "; certificate " + certificate.getId());
        // A physical record is kept, and what became of it written on it, in its custody.
        for (DueRecords.Due record : current) {
            if (record.physical()) {
                PhysicalRecords.disposed(privileged, record, run, certificate, person, approvers, disposed, now);
            }
        }
        log.info("Disposition run {} disposed of {} record(s); certificate {}", longValue(run.getPropertyValue(RUN_NUMBER)),
                current.size(), certificate.getId());
        return DISPOSED;
    }

    /** The certificate, written beside the run and made a record, so that its CSV cannot be replaced. */
    private static DocumentModel certificate(CoreSession privileged, DocumentModel folder, DocumentModel run,
            List<DueRecords.Due> records, Calendar disposedAt) {
        long number = longValue(run.getPropertyValue(RUN_NUMBER));
        String startedBy = String.valueOf(run.getPropertyValue(RUN_STARTED_BY));
        Calendar startedAt = (Calendar) run.getPropertyValue(RUN_STARTED_AT);
        List<CertificateCsv.Approval> approvals = new ArrayList<>();
        for (Map<String, Serializable> approval : approvals(run)) {
            approvals.add(new CertificateCsv.Approval(String.valueOf(approval.get("by")), (Calendar) approval.get("at")));
        }
        byte[] csv = CertificateCsv.write(number, startedBy, startedAt, approvals, disposedAt, records);
        String sha256 = CertificateCsv.sha256(csv);
        Blob blob = Blobs.createBlob(csv);
        blob.setMimeType("text/csv");
        blob.setEncoding("UTF-8");
        blob.setFilename("disposition-certificate-" + number + ".csv");

        DocumentModel certificate = privileged.createDocumentModel(folder.getPathAsString(), "certificate-" + number,
                CERTIFICATE_TYPE);
        certificate.setPropertyValue(TITLE, "Disposition certificate, run " + number);
        certificate.setPropertyValue(CERT_RUN, run.getId());
        certificate.setPropertyValue(CERT_RUN_NUMBER, number);
        certificate.setPropertyValue(CERT_STARTED_BY, startedBy);
        certificate.setPropertyValue(CERT_STARTED_AT, startedAt);
        certificate.setPropertyValue(CERT_APPROVALS, (Serializable) approvals(run));
        certificate.setPropertyValue(CERT_DISPOSED_AT, disposedAt);
        certificate.setPropertyValue(CERT_METHOD, CertificateCsv.methods(records));
        certificate.setPropertyValue(CERT_RECORD_COUNT, (long) records.size());
        List<Map<String, Serializable>> rows = new ArrayList<>();
        for (DueRecords.Due record : records) {
            Map<String, Serializable> row = row(record, null, null);
            row.remove("status");
            row.remove("reason");
            rows.add(row);
        }
        certificate.setPropertyValue(CERT_RECORDS, (Serializable) rows);
        certificate.setPropertyValue(CERT_SHA256, sha256);
        certificate.setPropertyValue(FILE_CONTENT, (Serializable) blob);
        DocumentModel created = ServiceWrites.run(() -> privileged.createDocument(certificate));
        // A record's main file cannot be changed or removed: the repository keeps the CSV as written.
        ServiceWrites.run(() -> privileged.makeRecord(created.getRef()));
        return created;
    }

    // --- Shared -------------------------------------------------------------------------------------

    /**
     * The repository's {@code DispositionRuns} folder at {@code parent}, checked: a request is filed in
     * it and nowhere else, and it blocks every permission it would inherit, so that only its own
     * grants count.
     */
    static DocumentModel folderOf(CoreSession privileged, DocumentRef parent) {
        DocumentModel folder = parent == null || !privileged.exists(parent) ? null : privileged.getDocument(parent);
        if (folder == null || !RUNS_TYPE.equals(folder.getType()) || folder.isProxy() || folder.isVersion()) {
            throw new DispositionRefusal(400, "not-in-runs-folder",
                    "A disposition request is filed in the repository's disposition runs folder, a " + RUNS_TYPE + ".");
        }
        // Where no one but an administrator removes or copies what holds it, and the only one: a
        // folder an administrator moved or copied elsewhere takes no request until it is put back.
        if (!atRoot(privileged, folder.getParentRef()) || folders(privileged) != 1 || folder.isTrashed()) {
            throw new DispositionRefusal(409, "folder-misplaced",
                    "The repository's disposition runs folder must be its one, at the repository's root, out of the trash; "
                            + "until an administrator puts it back, no request is taken.");
        }
        if (!blocksInheritance(privileged.getACP(folder.getRef()))) {
            throw new DispositionRefusal(409, "folder-inherits",
                    "The disposition runs folder must block the permissions it would inherit, so that only its own grants "
                            + "count; until an administrator blocks them, no request is taken.");
        }
        return folder;
    }

    /** Whether the folder's own ACL holds the block: everything denied to everyone, for all time. */
    static boolean blocksInheritance(ACP acp) {
        ACL local = acp == null ? null : acp.getACL(ACL.LOCAL_ACL);
        if (local == null) {
            return false;
        }
        for (ACE ace : local.getACEs()) {
            if (SecurityConstants.EVERYONE.equals(ace.getUsername())
                    && SecurityConstants.EVERYTHING.equals(ace.getPermission()) && !ace.isGranted()
                    && ace.getBegin() == null && ace.getEnd() == null) {
                return true;
            }
        }
        return false;
    }

    /** The person filing: never the system or an anonymous user. */
    static NuxeoPrincipal person(CoreSession session) {
        return person(session, "A disposition request");
    }

    /** The person filing {@code what}: never the system or an anonymous user. */
    static NuxeoPrincipal person(CoreSession session, String what) {
        NuxeoPrincipal principal = session.getPrincipal();
        if (principal == null || principal.isAnonymous()
                || SecurityConstants.SYSTEM_USERNAME.equals(principal.getName())) {
            throw new DispositionRefusal(403, "not-a-person", what + " is filed by a person.");
        }
        return principal;
    }

    private static String text(DocumentModel doc, String xpath) {
        return doc.getPropertyValue(xpath) instanceof String value ? value.trim() : "";
    }

    private static void close(DocumentModel run, String state, String by, Instant now) {
        run.setPropertyValue(RUN_STATE, state);
        run.setPropertyValue(RUN_CLOSED_BY, by);
        run.setPropertyValue(RUN_CLOSED_AT, calendar(now));
    }

    /** What every entry of a run's says: the run's number and id. */
    private static Map<String, Serializable> runInfo(String runId, long number) {
        Map<String, Serializable> info = new HashMap<>();
        info.put(RecordsAudit.RUN_NUMBER, number);
        info.put(RecordsAudit.RUN_UID, runId);
        return info;
    }

    /** The records a run keeps, as its entries name them. */
    private static List<RecordsAudit.Subject> subjects(List<Map<String, Serializable>> records) {
        List<RecordsAudit.Subject> subjects = new ArrayList<>();
        for (Map<String, Serializable> record : records) {
            subjects.add(new RecordsAudit.Subject(String.valueOf(record.get("uid")), (String) record.get("path"),
                    (String) record.get("type")));
        }
        return subjects;
    }

    private static Map<String, Serializable> row(DueRecords.Due record, String status, String reason) {
        Map<String, Serializable> row = new LinkedHashMap<>();
        row.put("uid", record.uid());
        row.put("path", record.path());
        row.put("title", record.title());
        row.put("type", record.type());
        row.put("ruleId", record.ruleId());
        row.put("ruleTitle", record.ruleTitle());
        row.put("retentionEnded", record.retentionEnded());
        row.put("barcode", record.barcode());
        row.put("disposal", record.disposal());
        row.put("transferTo", record.transferTo());
        row.put("status", status);
        row.put("reason", reason);
        return row;
    }

    static List<Map<String, Serializable>> records(DocumentModel run) {
        return copyList(run, RUN_RECORDS);
    }

    static List<Map<String, Serializable>> approvals(DocumentModel run) {
        return copyList(run, RUN_APPROVALS);
    }

    /** A list of complex values, copied, so that changing it changes nothing until it is set back. */
    static List<Map<String, Serializable>> copyList(DocumentModel doc, String xpath) {
        List<Map<String, Serializable>> copy = new ArrayList<>();
        if (doc.getPropertyValue(xpath) instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> map) {
                    Map<String, Serializable> entry = new LinkedHashMap<>();
                    map.forEach((key, value) -> entry.put(String.valueOf(key), (Serializable) value));
                    copy.add(entry);
                }
            }
        }
        return copy;
    }

    static long longValue(Object value) {
        return value instanceof Number number ? number.longValue() : 0L;
    }

    static Calendar calendar(Instant instant) {
        GregorianCalendar calendar = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        calendar.setTimeInMillis(instant.toEpochMilli());
        return calendar;
    }

    /** A name as the log shows it: no character that could start a line of its own. */
    static String printable(String name) {
        StringBuilder out = new StringBuilder();
        String.valueOf(name).codePoints().limit(128)
                .forEach(point -> out.appendCodePoint(Character.isISOControl(point) ? '?' : point));
        return out.toString();
    }
}
