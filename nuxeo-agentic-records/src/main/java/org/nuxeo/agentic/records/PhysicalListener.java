package org.nuxeo.agentic.records;

import static org.nuxeo.agentic.records.Physical.DESK_TYPE;
import static org.nuxeo.agentic.records.Physical.LOCATION_TYPE;
import static org.nuxeo.agentic.records.Physical.RECORD_TYPE;
import static org.nuxeo.agentic.records.Physical.REQUEST_TYPE;

import java.time.Clock;
import java.util.List;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.event.CoreEventConstants;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Physical records' one way in, and their guard: a synchronous listener on the repository's
 * document events, run in the thread of the person who caused them, as {@link DispositionListener}
 * is for the disposition review.
 *
 * <ul>
 * <li><b>A {@code PhysicalRecord} made</b> is given its barcode, its location's path and its first
 * custody entry ({@link PhysicalRecords#creating}); <b>a {@code PhysicalLocation}</b> its place in
 * the hierarchy and its path.</li>
 * <li><b>A {@code CustodyRequest} filed</b> in the {@code CustodyDesk} moves, checks out or returns a
 * record ({@link Custody#file}); once created, only its filer may read it.</li>
 * <li><b>Everything else is refused</b>, but the add-on's own writes ({@link ServiceWrites}): a change
 * to what the server writes of a record, a location or a request; a record, a location, a request
 * or a desk copied, checked in, restored or imported; a location or a request moved; a record or a
 * request deleted or put in the trash but by an administrator; a location deleted or put in the
 * trash while it holds a record; and a folder copied that holds any of them, or deleted, but by an
 * administrator, that holds a record, since the repository takes a folder's contents along with no
 * event of their own.</li>
 * </ul>
 *
 * A refusal throws, after marking the person's transaction for rollback, so that nothing of it is
 * written.
 */
public class PhysicalListener implements EventListener {

    private static final Logger log = LogManager.getLogger(PhysicalListener.class);

    /** What a folder's copy would take along, with no event of its own. */
    private static final List<String> COPIED = List.of(RECORD_TYPE, LOCATION_TYPE, REQUEST_TYPE);

    /** What is done to a folder of anyone's that takes what it holds along. */
    private static final java.util.Set<String> FOLDER_EVENTS = java.util.Set.of(DocumentEventTypes.ABOUT_TO_COPY,
            DocumentEventTypes.ABOUT_TO_REMOVE, "documentTrashed");

    private final PhysicalRecords records;

    private final Custody custody;

    public PhysicalListener() {
        this(new PhysicalRecords(Clock.systemUTC()), new Custody(Clock.systemUTC(), Dispositions.CLUSTER));
    }

    PhysicalListener(PhysicalRecords records, Custody custody) {
        this.records = records;
        this.custody = custody;
    }

    @Override
    public void handleEvent(Event event) {
        if (!(event.getContext() instanceof DocumentEventContext context)) {
            return;
        }
        DocumentModel doc = context.getSourceDocument();
        if (doc == null || ServiceWrites.active()) {
            return;
        }
        String name = event.getName();
        boolean ours = Physical.TYPES.contains(doc.getType());
        // Another document matters only as a folder, copied, deleted or put in the trash with what it
        // holds.
        if (!ours && (!doc.isFolder() || doc.isProxy() || doc.isVersion() || !FOLDER_EVENTS.contains(name))) {
            return;
        }
        CoreSession session = context.getCoreSession();
        try {
            if (ours) {
                handle(name, context, session, doc);
            } else {
                folder(name, session, doc);
            }
        } catch (DispositionRefusal refusal) {
            log.warn("Physical records: {} of a {} by {} refused, {}: {}", name, doc.getType(), who(session),
                    refusal.getStatusCode(), refusal.getCode());
            fail(event);
            throw refusal;
        } catch (RuntimeException e) {
            log.error("Physical records: {} of a {} by {} failed; nothing of it is kept", name, doc.getType(), who(session),
                    e);
            fail(event);
            throw e;
        }
    }

    private static void fail(Event event) {
        TransactionHelper.setTransactionRollbackOnly();
        event.markBubbleException();
    }

    private void handle(String event, DocumentEventContext context, CoreSession session, DocumentModel doc) {
        String type = doc.getType();
        // A version or a proxy is the platform's: made from the live document, which is checked.
        boolean live = !doc.isProxy() && !doc.isVersion();
        switch (event) {
        case DocumentEventTypes.ABOUT_TO_CREATE -> {
            if (!live) {
                return;
            }
            switch (type) {
            case RECORD_TYPE -> records.creating(session, doc);
            case LOCATION_TYPE -> PhysicalRecords.locationCreating(session, doc);
            case DESK_TYPE -> Custody.deskCreated(session, doc);
            default -> custody.file(session, doc);
            }
        }
        case DocumentEventTypes.DOCUMENT_CREATED -> {
            if (live && RECORD_TYPE.equals(type)) {
                PhysicalRecords.created(session, doc);
            } else if (live && REQUEST_TYPE.equals(type)) {
                Custody.restrict(session, doc);
            }
        }
        case "beforeDocumentModification" -> {
            switch (type) {
            case RECORD_TYPE -> PhysicalRecords.modified(context, doc);
            case LOCATION_TYPE -> PhysicalRecords.locationModified(context, doc);
            case REQUEST_TYPE -> PhysicalRecords.requestModified(context, doc);
            default -> {
                // The desk has nothing of the add-on's.
            }
            }
        }
        case DocumentEventTypes.ABOUT_TO_REMOVE, "documentTrashed" -> {
            if (!live) {
                return;
            }
            if (LOCATION_TYPE.equals(type)) {
                // What it holds by where its records are kept, and what is below it as a folder: a
                // record, or a folder of sites, filed inside it, which its deletion would take along.
                if (holdsRecords(session, doc)) {
                    if (!isAdministrator(session)) {
                        throw new DispositionRefusal(409, "holds-records",
                                "This location, or one inside it, holds physical records: they are moved out of it first.");
                    }
                    log.warn("Physical records: {} {}s the location {}, which holds physical records", who(session),
                            DocumentEventTypes.ABOUT_TO_REMOVE.equals(event) ? "delete" : "trashe", doc.getId());
                    return;
                }
                folder(event, session, doc);
                return;
            }
            if (!isAdministrator(session)) {
                throw new DispositionRefusal(403, "kept", "A physical record, its custody desk and its custody requests are "
                        + "kept: only an administrator deletes one, or puts it in the trash.");
            }
            log.warn("Physical records: {} {}s the {} {}", who(session),
                    DocumentEventTypes.ABOUT_TO_REMOVE.equals(event) ? "delete" : "trashe", type, doc.getId());
        }
        case DocumentEventTypes.ABOUT_TO_MOVE -> {
            // A record is filed where its records are, and refiled as they are; the rest stays put.
            // A rename in place moves nothing: the trash renames a document so before it trashes it,
            // and the trash's own rules then apply.
            if (inPlace(session, context, doc) || DESK_TYPE.equals(type) && isAdministrator(session)) {
                return;
            }
            if (RECORD_TYPE.equals(type)) {
                if (intoPlace(session, context)) {
                    throw new DispositionRefusal(403, "kept", "A physical record is filed where its records are, not "
                            + "inside a location or the custody desk: where it is kept is its custody's, by a move.");
                }
                return;
            }
            throw new DispositionRefusal(403, "kept", LOCATION_TYPE.equals(type)
                    ? "A location is not moved: every record there carries its path. Make a new one, and move the records."
                    : "A custody request, or the custody desk, stays where it was filed.");
        }
        case DocumentEventTypes.ABOUT_TO_COPY -> throw new DispositionRefusal(403, "kept", RECORD_TYPE.equals(type)
                ? "A physical record is not copied, since the copy would carry its barcode and its custody: make a new one."
                : "A location, a custody request or the custody desk is not copied.");
        case "aboutToImport" -> throw new DispositionRefusal(403, "server-only",
                "A physical record, a location or a custody request is made through the server's checks, not imported.");
        default -> throw new DispositionRefusal(403, "kept",
                "A physical record, a location, a custody request or the custody desk is not checked in or restored.");
        }
    }

    /**
     * A folder of anyone's, copied, deleted or put in the trash: refused when it would take physical
     * records along. The trash puts a folder's documents in the trash after it, in the background, as
     * the person who trashed it, which an administrator's alone takes a physical record's.
     */
    private static void folder(String event, CoreSession session, DocumentModel folder) {
        CoreInstance.doPrivileged(session, (CoreSession privileged) -> {
            if (DocumentEventTypes.ABOUT_TO_COPY.equals(event)) {
                if (PhysicalRecords.holds(privileged, folder, COPIED)) {
                    throw new DispositionRefusal(403, "kept", "This folder holds physical records, locations or custody "
                            + "requests, and is not copied, since each copy would carry its barcode or its record.");
                }
                return;
            }
            // An administrator deletes what they will, as every document: it is logged.
            if (isAdministrator(session)) {
                if (PhysicalRecords.holds(privileged, folder, List.of(RECORD_TYPE))
                        || PhysicalRecords.sitesHoldRecords(privileged, folder)) {
                    log.warn("Physical records: {} {} the folder {}, which holds physical records or their locations",
                            who(session), DocumentEventTypes.ABOUT_TO_REMOVE.equals(event) ? "deletes" : "trashes",
                            folder.getId());
                }
                return;
            }
            if (PhysicalRecords.holds(privileged, folder, List.of(RECORD_TYPE))) {
                throw new DispositionRefusal(403, "kept", "This folder holds physical records, whose custody is kept: "
                        + "only an administrator deletes it, or puts it in the trash.");
            }
            if (PhysicalRecords.sitesHoldRecords(privileged, folder)) {
                throw new DispositionRefusal(409, "holds-records",
                        "This folder holds locations where physical records are: they are moved out of them first.");
            }
        });
    }

    /** Whether a move keeps {@code doc} in its own folder: a rename. */
    private static boolean inPlace(CoreSession session, DocumentEventContext context, DocumentModel doc) {
        if (!(context.getProperty(CoreEventConstants.DESTINATION_REF) instanceof DocumentRef destination)
                || doc.getParentRef() == null) {
            return false;
        }
        return CoreInstance.doPrivileged(session, (CoreSession privileged) -> privileged.exists(destination)
                && privileged.getDocument(destination).getId().equals(privileged.getDocument(doc.getParentRef()).getId()));
    }

    /** Whether a move puts a document inside a location or the custody desk, which hold their own kinds alone. */
    private static boolean intoPlace(CoreSession session, DocumentEventContext context) {
        if (!(context.getProperty(CoreEventConstants.DESTINATION_REF) instanceof DocumentRef destination)) {
            return false;
        }
        return CoreInstance.doPrivileged(session, (CoreSession privileged) -> {
            if (!privileged.exists(destination)) {
                return false;
            }
            String into = privileged.getDocument(destination).getType();
            return LOCATION_TYPE.equals(into) || DESK_TYPE.equals(into);
        });
    }

    private static boolean holdsRecords(CoreSession session, DocumentModel location) {
        return CoreInstance.doPrivileged(session,
                (CoreSession privileged) -> PhysicalRecords.holdsRecords(privileged, location.getId()));
    }

    private static boolean isAdministrator(CoreSession session) {
        return session != null && session.getPrincipal() != null && session.getPrincipal().isAdministrator();
    }

    private static String who(CoreSession session) {
        NuxeoPrincipal principal = session == null ? null : session.getPrincipal();
        return principal == null ? "nobody" : Dispositions.printable(principal.getName());
    }
}
