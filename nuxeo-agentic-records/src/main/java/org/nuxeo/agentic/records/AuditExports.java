package org.nuxeo.agentic.records;

import static org.nuxeo.agentic.records.Disposition.*;

import java.io.IOException;
import java.io.Serializable;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

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
import org.nuxeo.ecm.core.api.PathRef;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.api.security.impl.ACLImpl;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.ecm.core.query.sql.model.OrderByExprs;
import org.nuxeo.ecm.core.query.sql.model.Predicates;
import org.nuxeo.ecm.core.query.sql.model.QueryBuilder;
import org.nuxeo.ecm.platform.audit.api.AuditReader;
import org.nuxeo.ecm.platform.audit.api.LogEntry;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * The audit export: what the platform's audit holds of the documents under a folder, over a period,
 * for a records specialist.
 *
 * <h2>Filed, then written</h2>
 * A person with {@code ExportRecordsAudit} on the repository's disposition runs folder files a
 * {@code RecordsAuditExport} there, naming the folder and the period ({@link #request}). The add-on
 * checks it then, in the person's transaction, and either refuses it, and nothing is written, or keeps
 * it, {@code pending}. Once that transaction has committed, the add-on writes the export in the
 * background ({@link #generate}): it reads the audit a page at a time and writes each entry to two
 * files on disk as it goes, so that no period is too long to hold in memory, and then keeps both
 * files on the export, with their SHA-256 and their counts, and makes it a record.
 *
 * <h2>What it holds</h2>
 * Every entry of the audit whose document was the folder, or under it, when it was recorded, and
 * whose event happened in the period: the audit's order, the order the entries were written. An
 * entry about a document the filer may not read is left out, and counted; one about a document that
 * no longer exists is kept, since the audit is then all that remains of it, as with a record
 * disposed of.
 */
final class AuditExports {

    private static final Logger log = LogManager.getLogger(AuditExports.class);

    /** How many entries the audit is asked for at a time. */
    static final int PAGE = 500;

    /** How many documents' readability a written export remembers, the most recent first. */
    static final int READABLE_CACHE = 10_000;

    /** The longest an export may take to write, in seconds: its own transaction's timeout. */
    static final int GENERATION_TIMEOUT = 4 * 60 * 60;

    /**
     * How long after its period's end an export waits before it reads the audit, in seconds: the
     * platform writes its entries a moment after their events, and the add-on's in the background, so
     * that an export of a period that has just ended would miss its last ones.
     */
    static final String SETTLE_PROPERTY = "nuxeo.agentic.records.audit.export.settleSeconds";

    static final int DEFAULT_SETTLE = 30;

    static final int LIMIT_SETTLE = 600;

    private final Clock clock;

    private final Supplier<AuditReader> audit;

    AuditExports(Clock clock) {
        this(clock, AuditAccess::reader);
    }

    AuditExports(Clock clock, Supplier<AuditReader> audit) {
        this.clock = clock;
        this.audit = audit;
    }

    // --- Filed --------------------------------------------------------------------------------------

    /**
     * Checks a {@code RecordsAuditExport} as it is filed, by the person of {@code session}, and fills in
     * what the server writes; or refuses it. Whatever the filer sent but the scope, the period and the
     * comment is replaced.
     */
    void request(CoreSession session, DocumentModel export) {
        NuxeoPrincipal person = Dispositions.person(session);
        String path = text(export, EXPORT_PATH);
        Calendar from = date(export, EXPORT_FROM);
        Calendar asked = date(export, EXPORT_TO);
        String comment = text(export, EXPORT_COMMENT);
        if (from == null || asked == null || !from.before(asked)) {
            throw new DispositionRefusal(400, "bad-request",
                    "An audit export names its period, rexp:from and rexp:to, the first before the second.");
        }
        // A period that ends after the export is filed ends when it is filed: what is to come is not
        // in the audit yet, and the export says the period it covers.
        Instant now = clock.instant();
        Calendar to = asked.toInstant().isAfter(now) ? Dispositions.calendar(now) : asked;
        if (!from.before(to)) {
            throw new DispositionRefusal(400, "bad-request",
                    "An audit export's period has begun before it is filed: rexp:from is in the past.");
        }
        if (comment.length() > MAX_COMMENT) {
            throw new DispositionRefusal(400, "bad-request", "An export's comment is at most " + MAX_COMMENT + " characters.");
        }
        // By its path, or by its id, as a form's document picker names it: the server writes its path.
        DocumentRef named = path.startsWith("/") && path.length() > 1 && path.length() <= 4096 ? new PathRef(path)
                : DueRecords.ID.matcher(path).matches() ? new IdRef(path) : null;
        if (named == null) {
            throw new DispositionRefusal(400, "bad-request",
                    "An audit export names the folder it covers, rexp:path, by its path from the repository's root or its id, not the root itself.");
        }
        DocumentRef folderRef = export.getParentRef();
        String[] scope = new String[1];
        CoreInstance.doPrivileged(session, (CoreSession privileged) -> {
            DocumentModel folder = Dispositions.folderOf(privileged, folderRef);
            if (!session.hasPermission(folder.getRef(), EXPORT_PERMISSION)) {
                throw new DispositionRefusal(403, "permission",
                        "An audit export needs the ExportRecordsAudit permission on the disposition runs folder.");
            }
            // Named the same way whether it does not exist or the person may not read it.
            if (!privileged.exists(named) || !session.hasPermission(named, SecurityConstants.READ)) {
                throw new DispositionRefusal(404, "no-folder", "The export names no folder you may read.");
            }
            DocumentModel covered = privileged.getDocument(named);
            if (!covered.isFolder() || covered.isProxy() || covered.isVersion()
                    || covered.getId().equals(privileged.getRootDocument().getId())) {
                throw new DispositionRefusal(400, "not-a-folder",
                        "An audit export covers a folder of the repository, not a document, nor the root itself.");
            }
            scope[0] = covered.getPathAsString();
        });
        export.setPropertyValue(EXPORT_TO, to);
        export.setPropertyValue(TITLE, "Audit export of " + scope[0] + ", " + from.toInstant() + " to " + to.toInstant()
                + ", by " + person.getName());
        export.setPropertyValue(EXPORT_PATH, scope[0]);
        export.setPropertyValue(EXPORT_COMMENT, comment.isEmpty() ? null : comment);
        export.setPropertyValue(EXPORT_BY, person.getName());
        export.setPropertyValue(EXPORT_AT, Dispositions.calendar(now));
        export.setPropertyValue(EXPORT_STATE, EXPORT_PENDING);
        for (String xpath : List.of(EXPORT_GENERATED_AT, EXPORT_ENTRY_COUNT, EXPORT_OMITTED_COUNT, EXPORT_CSV_SHA256,
                EXPORT_JSON_SHA256, EXPORT_FAILURE, FILE_CONTENT, FILES)) {
            export.setPropertyValue(xpath, null);
        }
        log.info("Audit export of {} filed by {}", Dispositions.printable(scope[0]), Dispositions.printable(person.getName()));
    }

    /**
     * Once filed, an export is readable by its filer alone, and the server's administrators: it lists
     * who read what. Its folder's readers do not see it.
     */
    static void restrict(CoreSession session, DocumentModel export) {
        String by = String.valueOf(export.getPropertyValue(EXPORT_BY));
        CoreInstance.doPrivileged(session, (CoreSession privileged) -> {
            ACP acp = new ACPImpl();
            ACL acl = new ACLImpl(ACL.LOCAL_ACL);
            acl.add(new ACE(by, SecurityConstants.READ, true));
            acl.add(ACE.BLOCK);
            acp.addACL(acl);
            privileged.setACP(export.getRef(), acp, true);
        });
    }

    // --- Written ------------------------------------------------------------------------------------

    /**
     * Writes the export {@code exportId} filed by {@code by}, once: an export no longer pending is left
     * as it is. Runs in the background, in a transaction of its own of up to
     * {@value #GENERATION_TIMEOUT} seconds, and ends with the caller's transaction started again.
     */
    void generate(String repository, String exportId, NuxeoPrincipal by) {
        if (TransactionHelper.isTransactionActive()) {
            TransactionHelper.commitOrRollbackTransaction();
        }
        if (by == null) {
            log.error("Audit export {}: its filer is not known, so it is not written, and is marked failed", exportId);
            failed(repository, exportId);
            TransactionHelper.startTransaction();
            return;
        }
        Path csv = null;
        Path json = null;
        boolean done = false;
        try {
            csv = Framework.createTempFilePath("records-audit-", ".csv");
            json = Framework.createTempFilePath("records-audit-", ".json");
            Path csvFile = csv;
            Path jsonFile = json;
            settle(inTransaction(0, () -> CoreInstance.doPrivileged(repository, (CoreSession privileged) -> {
                IdRef ref = new IdRef(exportId);
                return privileged.exists(ref) && privileged.getDocument(ref).getPropertyValue(EXPORT_TO) instanceof Calendar to
                        ? to.toInstant() : null;
            })));
            done = inTransaction(GENERATION_TIMEOUT, () -> CoreInstance.doPrivileged(repository,
                    (CoreSession privileged) -> write(privileged, exportId, by, csvFile, jsonFile)));
        } catch (IOException | RuntimeException e) {
            log.error("Audit export {}: it could not be written, and is marked failed", exportId, e);
            failed(repository, exportId);
        } finally {
            delete(csv);
            delete(json);
            TransactionHelper.startTransaction();
        }
        if (done) {
            log.info("Audit export {} written", exportId);
        }
    }

    /**
     * Waits, with no transaction open, until {@code end} is {@value #DEFAULT_SETTLE} seconds past, or as
     * many as {@value #SETTLE_PROPERTY} says, 0 to {@value #LIMIT_SETTLE}.
     */
    private void settle(Instant end) {
        if (end == null) {
            return;
        }
        long wait = Duration.between(clock.instant(), end.plusSeconds(settleSeconds())).toMillis();
        if (wait <= 0) {
            return;
        }
        try {
            Thread.sleep(Math.min(wait, LIMIT_SETTLE * 1000L));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("The export was interrupted before it read the audit", e);
        }
    }

    static int settleSeconds() {
        String value = Framework.getProperty(SETTLE_PROPERTY);
        if (value == null || value.isBlank()) {
            return DEFAULT_SETTLE;
        }
        try {
            int seconds = Integer.parseInt(value.trim());
            return seconds < 0 || seconds > LIMIT_SETTLE ? DEFAULT_SETTLE : seconds;
        } catch (NumberFormatException e) {
            return DEFAULT_SETTLE;
        }
    }

    /** The export written, in the transaction of {@link #generate}: or {@code false} when it was not pending. */
    private boolean write(CoreSession privileged, String exportId, NuxeoPrincipal by, Path csvFile, Path jsonFile) {
        IdRef ref = new IdRef(exportId);
        if (!privileged.exists(ref)) {
            return false;
        }
        DocumentModel export = privileged.getDocument(ref);
        if (!EXPORT_TYPE.equals(export.getType()) || !EXPORT_PENDING.equals(export.getPropertyValue(EXPORT_STATE))) {
            return false;
        }
        String scope = String.valueOf(export.getPropertyValue(EXPORT_PATH));
        Calendar from = (Calendar) export.getPropertyValue(EXPORT_FROM);
        Calendar to = (Calendar) export.getPropertyValue(EXPORT_TO);
        String filer = String.valueOf(export.getPropertyValue(EXPORT_BY));
        Instant started = clock.instant();

        Map<String, Object> header = new LinkedHashMap<>();
        header.put("format", AuditExportFiles.FORMAT);
        header.put("export_uid", export.getId());
        header.put("repository", privileged.getRepositoryName());
        header.put("scope", scope);
        header.put("from", from);
        header.put("to", to);
        header.put("requested_by", filer);
        header.put("requested_at", export.getPropertyValue(EXPORT_AT));
        header.put("generated_at", Dispositions.calendar(started));
        header.put("order", "entry_id, the order the audit wrote its entries");
        header.put("columns", AuditExportFiles.COLUMNS);

        long omitted = 0;
        String[] sha256;
        CoreSession reader = CoreInstance.getCoreSession(privileged.getRepositoryName(), by);
        Readable readable = new Readable(privileged, reader, scope);
        try (AuditExportFiles files = new AuditExportFiles(csvFile, jsonFile, header)) {
            AuditReader reading = audit.get();
            long last = 0;
            while (true) {
                List<?> page = reading.queryLogs(query(privileged.getRepositoryName(), scope, from, to, last));
                for (Object item : page) {
                    LogEntry entry = (LogEntry) item;
                    last = Math.max(last, entry.getId());
                    if (!within(scope, entry.getDocPath())) {
                        continue;
                    }
                    Boolean exists = readable.exists(entry.getDocUUID(), entry.getDocPath());
                    if (exists == null) {
                        omitted++;
                        continue;
                    }
                    files.write(entry, AuditAccess.extended(entry), exists);
                }
                if (page.size() < PAGE) {
                    break;
                }
            }
            Map<String, Object> summary = new LinkedHashMap<>();
            summary.put("omitted", omitted);
            summary.put("completed_at", Dispositions.calendar(clock.instant()));
            sha256 = files.finish(summary);
            long rows = files.rows();
            keep(privileged, export, csvFile, jsonFile, rows, omitted, sha256, started);
            Map<String, Serializable> extended = new HashMap<>();
            extended.put("scope", scope);
            extended.put("from", from.toInstant().toString());
            extended.put("to", to.toInstant().toString());
            extended.put("entryCount", rows);
            extended.put("omittedCount", omitted);
            extended.put("csvSha256", sha256[0]);
            extended.put("jsonSha256", sha256[1]);
            RecordsAudit.fire(RecordsAudit.AUDIT_EXPORTED, privileged, by, privileged.getDocument(ref),
                    "Audit export of " + scope + ": " + rows + " entries, " + omitted + " left out", extended);
            return true;
        } catch (IOException e) {
            throw new IllegalStateException("The export's files could not be written", e);
        }
    }

    /** The audit's entries under {@code scope} in the period, after entry {@code last}, the audit's order. */
    static QueryBuilder query(String repository, String scope, Calendar from, Calendar to, long last) {
        QueryBuilder query = new QueryBuilder();
        query.predicate(Predicates.eq("repositoryId", repository));
        // A prefix the audit may read as a pattern: what it returns is held to the scope exactly, below.
        query.and(Predicates.startsWith("docPath", scope));
        query.and(Predicates.gte("eventDate", from.getTime()));
        query.and(Predicates.lt("eventDate", to.getTime()));
        query.and(Predicates.gt("id", last));
        query.order(OrderByExprs.asc("id"));
        query.limit(PAGE);
        return query;
    }

    /** Whether {@code path} is the scope's folder, or under it. */
    static boolean within(String scope, String path) {
        return path != null && (path.equals(scope) || path.startsWith(scope.endsWith("/") ? scope : scope + "/"));
    }

    /** The files and the figures kept on the export, which is then made a record: its CSV is the repository's to keep. */
    private void keep(CoreSession privileged, DocumentModel export, Path csvFile, Path jsonFile, long rows, long omitted,
            String[] sha256, Instant started) throws IOException {
        String base = "records-audit-" + export.getId();
        Blob csvBlob = Blobs.createBlob(csvFile.toFile(), "text/csv", "UTF-8", base + ".csv");
        Blob jsonBlob = Blobs.createBlob(jsonFile.toFile(), "application/json", "UTF-8", base + ".json");
        export.setPropertyValue(FILE_CONTENT, (Serializable) csvBlob);
        List<Map<String, Serializable>> attachments = new ArrayList<>();
        Map<String, Serializable> attachment = new HashMap<>();
        attachment.put("file", (Serializable) jsonBlob);
        attachments.add(attachment);
        export.setPropertyValue(FILES, (Serializable) attachments);
        export.setPropertyValue(EXPORT_ENTRY_COUNT, rows);
        export.setPropertyValue(EXPORT_OMITTED_COUNT, omitted);
        export.setPropertyValue(EXPORT_CSV_SHA256, sha256[0]);
        export.setPropertyValue(EXPORT_JSON_SHA256, sha256[1]);
        export.setPropertyValue(EXPORT_GENERATED_AT, Dispositions.calendar(started));
        export.setPropertyValue(EXPORT_STATE, EXPORT_DONE);
        DocumentModel saved = ServiceWrites.run(() -> privileged.saveDocument(export));
        ServiceWrites.run(() -> privileged.makeRecord(saved.getRef()));
    }

    /** An export that could not be written: marked so, with nothing kept, in a transaction of its own. */
    private static void failed(String repository, String exportId) {
        try {
            inTransaction(0, () -> CoreInstance.doPrivileged(repository, (CoreSession privileged) -> {
                IdRef ref = new IdRef(exportId);
                if (!privileged.exists(ref)) {
                    return null;
                }
                DocumentModel export = privileged.getDocument(ref);
                if (!EXPORT_PENDING.equals(export.getPropertyValue(EXPORT_STATE))) {
                    return null;
                }
                export.setPropertyValue(EXPORT_STATE, EXPORT_FAILED);
                export.setPropertyValue(EXPORT_FAILURE,
                        "The export could not be written; the server's log says why. File it again.");
                return ServiceWrites.run(() -> privileged.saveDocument(export));
            }));
        } catch (RuntimeException e) {
            log.error("Audit export {}: it could not be marked failed either", exportId, e);
        }
    }

    /**
     * {@code work} in a transaction of its own, in this thread, committed, or rolled back when it
     * throws: of {@code timeout} seconds, or the server's default when 0. No transaction is active
     * before or after.
     */
    private static <R> R inTransaction(int timeout, Supplier<R> work) {
        if (timeout > 0) {
            TransactionHelper.startTransaction(timeout);
        } else {
            TransactionHelper.startTransaction();
        }
        boolean done = false;
        try {
            R result = work.get();
            done = true;
            return result;
        } finally {
            // Whatever stopped the work, an Error included, nothing of it is kept.
            if (!done) {
                TransactionHelper.setTransactionRollbackOnly();
            }
            TransactionHelper.commitOrRollbackTransaction();
        }
    }

    private static void delete(Path file) {
        if (file == null) {
            return;
        }
        try {
            Files.deleteIfExists(file);
        } catch (IOException e) {
            log.warn("Audit export: a temporary file could not be deleted: {}", e.toString());
        }
    }

    /**
     * Whether the filer may read an entry's document, remembered for the most recent
     * {@value AuditExports#READABLE_CACHE} documents: {@code true} when they may, {@code false} when it
     * no longer exists, and {@code null} when it exists and they may not.
     */
    static final class Readable {

        /** What the filer may know of a document. */
        enum State {
            READABLE, GONE, UNREADABLE
        }

        private final CoreSession privileged;

        private final CoreSession reader;

        private final String scope;

        private final Map<String, State> documents = lru();

        private final Map<String, State> folders = lru();

        Readable(CoreSession privileged, CoreSession reader, String scope) {
            this.privileged = privileged;
            this.reader = reader;
            this.scope = scope;
        }

        private static Map<String, State> lru() {
            return new LinkedHashMap<>(16, 0.75f, true) {
                private static final long serialVersionUID = 1L;

                @Override
                protected boolean removeEldestEntry(Map.Entry<String, State> eldest) {
                    return size() > READABLE_CACHE;
                }
            };
        }

        /** {@code true}, {@code false} or {@code null}: readable, gone, or not the filer's to read. */
        Boolean exists(String uid, String path) {
            State state = state(uid, path);
            return state == State.UNREADABLE ? null : state == State.READABLE;
        }

        State state(String uid, String path) {
            if (uid == null || !DueRecords.ID.matcher(uid).matches()) {
                return State.UNREADABLE;
            }
            State state = documents.get(uid);
            if (state == null) {
                IdRef ref = new IdRef(uid);
                state = privileged.exists(ref)
                        ? reader.hasPermission(ref, SecurityConstants.READ) ? State.READABLE : State.UNREADABLE
                        : gone(path);
                documents.put(uid, state);
            }
            return state;
        }

        /**
         * A document that no longer exists, judged by the nearest folder above it that still does: kept
         * when the filer may read that folder. The scope's own folder, which they may read, is the
         * farthest this looks.
         */
        private State gone(String path) {
            String folder = parent(path);
            List<String> walked = new ArrayList<>();
            State state = State.GONE;
            while (folder != null && within(scope, folder)) {
                State cached = folders.get(folder);
                if (cached != null) {
                    state = cached;
                    break;
                }
                walked.add(folder);
                PathRef ref = new PathRef(folder);
                if (privileged.exists(ref)) {
                    state = reader.hasPermission(ref, SecurityConstants.READ) ? State.GONE : State.UNREADABLE;
                    break;
                }
                folder = parent(folder);
            }
            for (String each : walked) {
                folders.put(each, state);
            }
            return state;
        }

        private static String parent(String path) {
            int slash = path == null ? -1 : path.lastIndexOf('/');
            return slash <= 0 ? null : path.substring(0, slash);
        }
    }

    // --- Shared -------------------------------------------------------------------------------------

    private static String text(DocumentModel doc, String xpath) {
        return doc.getPropertyValue(xpath) instanceof String value ? value.trim() : "";
    }

    private static Calendar date(DocumentModel doc, String xpath) {
        return doc.getPropertyValue(xpath) instanceof Calendar calendar ? calendar : null;
    }
}
