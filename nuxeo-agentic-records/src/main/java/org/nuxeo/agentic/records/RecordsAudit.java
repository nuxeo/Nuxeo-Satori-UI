package org.nuxeo.agentic.records;

import java.io.Serializable;
import java.util.Calendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.nuxeo.common.utils.Path;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventService;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.ecm.core.event.impl.ShallowDocumentModel;
import org.nuxeo.runtime.api.Framework;

/**
 * What the add-on adds to the platform's audit, and how a records specialist reads every entry.
 *
 * <h2>The entries it adds</h2>
 * The platform's audit already records a record made, a retention set, extended or ended, a hold
 * placed or lifted, a deletion, and every file downloaded or shown (its {@code download} event,
 * whose {@code downloadReason} says which). The add-on adds only what is missing:
 * <ul>
 * <li>{@code recordViewed}: a record under retention or a legal hold sent to a person as a document
 * of its own, as the REST API answers a request for it ({@link RecordViewJsonWriter});</li>
 * <li>a disposition run's decisions, one entry per record of the run, so that each record's history
 * says which run held it, who decided and, once disposed of, its certificate: the platform logs the
 * deletion itself as the add-on's system session's;</li>
 * <li>{@code recordsAuditExported}: an audit export written, on the export;</li>
 * <li>a physical record's custody: registered at its location when it is made, moved, checked out
 * and returned, each with who, from where to where, when and why; and, once a run has disposed of
 * it, {@code recordDestroyed} or {@code recordTransferred}, since it is not deleted.</li>
 * </ul>
 * Each is a document event of the add-on's, fired in the transaction of what it records, so that a
 * refused or failed request records nothing; {@link RecordsAuditWriter} writes them to the audit
 * once that transaction has committed, in the background. The platform builds each entry from the
 * event as it builds its own: who, when, the document's id, path and type, the comment, and the
 * extended information below.
 */
final class RecordsAudit {

    /** The audit's category for every entry the add-on writes. */
    static final String CATEGORY = "records";

    static final String RECORD_VIEWED = "recordViewed";

    static final String RUN_STARTED = "dispositionRunStarted";

    static final String RUN_APPROVED = "dispositionRunApproved";

    static final String RUN_REJECTED = "dispositionRunRejected";

    static final String RUN_HALTED = "dispositionRunHalted";

    static final String RECORD_DISPOSED = "recordDisposed";

    static final String AUDIT_EXPORTED = "recordsAuditExported";

    /** A physical record disposed of by a run: destroyed or transferred, its document kept. */
    static final String RECORD_DESTROYED = "recordDestroyed";

    static final String RECORD_TRANSFERRED = "recordTransferred";

    /** A physical record's custody. */
    static final String CUSTODY_REGISTERED = "custodyRegistered";

    static final String CUSTODY_MOVED = "custodyMoved";

    static final String CUSTODY_CHECKED_OUT = "custodyCheckedOut";

    static final String CUSTODY_RETURNED = "custodyReturned";

    /** The events the add-on fires for the audit, which {@link RecordsAuditWriter} writes. */
    static final Set<String> EVENTS = Set.of(RECORD_VIEWED, RUN_STARTED, RUN_APPROVED, RUN_REJECTED, RUN_HALTED,
            RECORD_DISPOSED, RECORD_DESTROYED, RECORD_TRANSFERRED, CUSTODY_REGISTERED, CUSTODY_MOVED,
            CUSTODY_CHECKED_OUT, CUSTODY_RETURNED, AUDIT_EXPORTED);

    // --- The extended information of the add-on's entries, and the platform's it reads ----------------

    static final String RUN_NUMBER = "runNumber";

    static final String RUN_UID = "runUid";

    static final String APPROVAL = "approval";

    static final String STATUS = "status";

    static final String REASON = "reason";

    static final String CERTIFICATE_UID = "certificateUid";

    static final String CERTIFICATE_SHA256 = "certificateSha256";

    static final String STARTED_BY = "startedBy";

    static final String APPROVED_BY = "approvedBy";

    static final String RETAIN_UNTIL = "retainUntil";

    static final String LEGAL_HOLD = "legalHold";

    /** A physical record's: its barcode, and a custody entry's from where, to where, to whom and until when. */
    static final String BARCODE = "barcode";

    static final String FROM_LOCATION = "fromLocation";

    static final String FROM_PATH = "fromPath";

    static final String TO_LOCATION = "toLocation";

    static final String TO_PATH = "toPath";

    static final String BORROWER = "borrower";

    static final String DUE_BACK = "dueBack";

    /** A physical record's disposal: destroyed or transferred, and to whom. */
    static final String METHOD = "method";

    static final String TRANSFER_TO = "transferTo";

    /** The platform's, on its {@code download} entries. */
    static final String DOWNLOAD_REASON = "downloadReason";

    static final String BLOB_XPATH = "blobXPath";

    static final String BLOB_FILENAME = "blobFilename";

    /** An event context's property the platform's audit reads its extended information from. */
    static final String EXTENDED_INFOS = "extendedInfos";

    /**
     * A document's context data that keeps it as fired, rather than read again from the repository in
     * the background: the add-on's entries name each document as it was, a record disposed of
     * included.
     */
    static final String SKIP_REFETCH = "skipRefetchDocument";

    // --- How an export classifies an entry: its kind, and what it means, by the audit's event ID -------

    static final String KIND_RETENTION = "retention";

    static final String KIND_HOLD = "hold";

    static final String KIND_DISPOSITION = "disposition";

    static final String KIND_DELETION = "deletion";

    static final String KIND_READ = "read";

    static final String KIND_EXPORT = "export";

    static final String KIND_CUSTODY = "custody";

    static final String KIND_CHANGE = "change";

    static final String KIND_OTHER = "other";

    /** Each event a records specialist reads, in the order the export's README lists them: its kind, and what it means. */
    static final Map<String, String[]> MEANINGS = meanings();

    private static Map<String, String[]> meanings() {
        Map<String, String[]> map = new LinkedHashMap<>();
        // The platform's and the retention module's.
        map.put("afterMakeRecord", new String[] { KIND_RETENTION, "Made a record" });
        map.put("retentionRuleAttached", new String[] { KIND_RETENTION, "Retention rule applied" });
        map.put("afterSetRetention", new String[] { KIND_RETENTION, "Retention set" });
        map.put("afterExtendRetention", new String[] { KIND_RETENTION, "Retention extended" });
        map.put("afterUnsetRetention", new String[] { KIND_RETENTION, "Retention removed" });
        map.put("retentionExpired", new String[] { KIND_RETENTION, "Retention ended" });
        map.put("retentionActiveChanged", new String[] { KIND_RETENTION, "Retention switched on or off" });
        map.put("afterSetLegalHold", new String[] { KIND_HOLD, "Legal hold placed" });
        map.put("afterRemoveLegalHold", new String[] { KIND_HOLD, "Legal hold lifted" });
        // The add-on's.
        map.put(RUN_STARTED, new String[] { KIND_DISPOSITION, "Held in a disposition run" });
        map.put(RUN_APPROVED, new String[] { KIND_DISPOSITION, "Disposition run approved" });
        map.put(RUN_REJECTED, new String[] { KIND_DISPOSITION, "Disposition run rejected: record kept" });
        map.put(RUN_HALTED, new String[] { KIND_DISPOSITION, "Disposition run halted: nothing disposed of" });
        map.put(RECORD_DISPOSED, new String[] { KIND_DISPOSITION, "Disposed of: deleted, permanently" });
        map.put(RECORD_DESTROYED, new String[] { KIND_DISPOSITION, "Disposed of: destroyed, its record kept" });
        map.put(RECORD_TRANSFERRED, new String[] { KIND_DISPOSITION, "Disposed of: transferred, its record kept" });
        // A physical record's custody, the add-on's.
        map.put(CUSTODY_REGISTERED, new String[] { KIND_CUSTODY, "Registered at its location" });
        map.put(CUSTODY_MOVED, new String[] { KIND_CUSTODY, "Moved" });
        map.put(CUSTODY_CHECKED_OUT, new String[] { KIND_CUSTODY, "Checked out" });
        map.put(CUSTODY_RETURNED, new String[] { KIND_CUSTODY, "Returned" });
        // The platform's deletions.
        map.put("documentRemoved", new String[] { KIND_DELETION, "Deleted" });
        map.put("versionRemoved", new String[] { KIND_DELETION, "Version deleted" });
        map.put("proxyRemoved", new String[] { KIND_DELETION, "Proxy deleted" });
        // Reads: the platform's downloads, previews and renditions, and the add-on's views.
        map.put("download", new String[] { KIND_READ, "File downloaded or shown" });
        map.put(RECORD_VIEWED, new String[] { KIND_READ, "Viewed" });
        map.put(AUDIT_EXPORTED, new String[] { KIND_EXPORT, "Audit exported" });
        // The platform's other document events.
        map.put("documentCreated", new String[] { KIND_CHANGE, "Created" });
        map.put("documentCreatedByCopy", new String[] { KIND_CHANGE, "Created by a copy" });
        map.put("documentDuplicated", new String[] { KIND_CHANGE, "Copied" });
        map.put("documentModified", new String[] { KIND_CHANGE, "Modified" });
        map.put("documentMoved", new String[] { KIND_CHANGE, "Moved" });
        map.put("documentSecurityUpdated", new String[] { KIND_CHANGE, "Permissions changed" });
        map.put("documentLocked", new String[] { KIND_CHANGE, "Locked" });
        map.put("documentUnlocked", new String[] { KIND_CHANGE, "Unlocked" });
        map.put("documentCheckedIn", new String[] { KIND_CHANGE, "Version made" });
        map.put("documentRestored", new String[] { KIND_CHANGE, "Restored to a version" });
        map.put("documentTrashed", new String[] { KIND_CHANGE, "Put in the trash" });
        map.put("documentUntrashed", new String[] { KIND_CHANGE, "Taken out of the trash" });
        map.put("lifecycle_transition_event", new String[] { KIND_CHANGE, "Lifecycle state changed" });
        map.put("documentProxyPublished", new String[] { KIND_CHANGE, "Published" });
        map.put("sectionContentPublished", new String[] { KIND_CHANGE, "Published in a section" });
        map.put("addedToCollection", new String[] { KIND_CHANGE, "Added to a collection" });
        map.put("removedFromCollection", new String[] { KIND_CHANGE, "Removed from a collection" });
        map.put("blobDigestUpdated", new String[] { KIND_CHANGE, "File's digest recomputed" });
        return Map.copyOf(map);
    }

    static String kind(String event) {
        String[] meaning = MEANINGS.get(event);
        return meaning == null ? KIND_OTHER : meaning[0];
    }

    /** What the event means, in a few words; an event the add-on does not know reads as its ID. */
    static String what(String event) {
        String[] meaning = MEANINGS.get(event);
        return meaning == null ? String.valueOf(event) : meaning[1];
    }

    private RecordsAudit() {
    }

    // --- Firing them --------------------------------------------------------------------------------

    /**
     * A view of {@code doc}, when it is a record under retention or a legal hold, by the person it is
     * sent to: the person whose session read it, or, when the server read it with its own, the person
     * the server is answering. The server's own reads, for no one, are not logged. Reads only what the
     * document already holds: nothing else is asked of the repository, whatever the document.
     */
    static void viewed(DocumentModel doc) {
        if (doc == null || !doc.isUnderRetentionOrLegalHold()) {
            return;
        }
        CoreSession session = doc.getCoreSession();
        NuxeoPrincipal reader = session == null ? null : session.getPrincipal();
        if (isSystem(reader)) {
            reader = NuxeoPrincipal.getCurrent();
        }
        if (isSystem(reader)) {
            return;
        }
        Map<String, Serializable> extended = new HashMap<>();
        Calendar until = doc.getRetainUntil();
        if (until != null) {
            extended.put(RETAIN_UNTIL, until.toInstant().toString());
        }
        extended.put(LEGAL_HOLD, doc.hasLegalHold());
        fire(RECORD_VIEWED, session, reader, doc, null, extended);
    }

    /** No one, or the server itself. */
    private static boolean isSystem(NuxeoPrincipal principal) {
        return principal == null || SecurityConstants.SYSTEM_USERNAME.equals(principal.getName());
    }

    /** One document a run's entry is about: a record, as the run keeps it. */
    record Subject(String uid, String path, String type) {
    }

    /**
     * A run's decision, one entry per record of the run, as {@code by}: each says the run, and what
     * {@code extended} adds. The records are named as the run keeps them, so that a record disposed of
     * in the same transaction is still named.
     */
    static void run(String event, CoreSession session, NuxeoPrincipal by, List<Subject> records,
            Map<String, Serializable> extended, String comment) {
        String repository = session.getRepositoryName();
        for (Subject record : records) {
            if (record.uid() == null || record.path() == null) {
                continue;
            }
            fire(event, session, by, snapshot(record.uid(), repository, record.path(), record.type(), false, false, false,
                    false, Set.of(), null), comment, new HashMap<>(extended));
        }
    }

    /**
     * One entry about {@code doc}, as {@code by}, with what {@code extended} adds: about the document as
     * it is now, a snapshot of what the audit reads of it, so that nothing else is read again later.
     */
    static void fire(String event, CoreSession session, NuxeoPrincipal by, DocumentModel doc, String comment,
            Map<String, Serializable> extended) {
        Event fired = event(event, session, by, doc, comment, extended);
        if (fired != null) {
            Framework.getService(EventService.class).fireEvent(fired);
        }
    }

    /** The event {@link #fire} fires, or {@code null} for a document with no path. */
    static Event event(String event, CoreSession session, NuxeoPrincipal by, DocumentModel doc, String comment,
            Map<String, Serializable> extended) {
        if (doc.getPathAsString() == null) {
            return null;
        }
        DocumentModel snapshot = doc instanceof ShallowDocumentModel ? doc
                : snapshot(doc.getId(), doc.getRepositoryName(), doc.getPathAsString(), doc.getType(), doc.isFolder(),
                        doc.isVersion(), doc.isProxy(), doc.isImmutable(), new HashSet<>(doc.getFacets()),
                        doc.isLifeCycleLoaded() ? doc.getCurrentLifeCycleState() : null);
        DocumentEventContext context = new DocumentEventContext(session, by, snapshot);
        if (session == null) {
            context.setRepositoryName(doc.getRepositoryName());
        }
        context.setProperty("category", CATEGORY);
        if (comment != null) {
            context.setProperty("comment", comment);
        }
        context.setProperty(EXTENDED_INFOS, new HashMap<>(extended));
        return context.newEvent(event);
    }

    /** What the audit reads of a document, kept as it is now: never read again in the background. */
    static ShallowDocumentModel snapshot(String id, String repository, String path, String type, boolean folder,
            boolean version, boolean proxy, boolean immutable, Set<String> facets, String lifecycle) {
        Map<String, Serializable> context = new HashMap<>();
        context.put(SKIP_REFETCH, Boolean.TRUE);
        Path where = new Path(path);
        return new ShallowDocumentModel(id, repository, where.lastSegment(), where, type, folder, version, proxy,
                immutable, context, facets, lifecycle);
    }
}
