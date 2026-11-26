package org.nuxeo.agentic.records;

import static org.nuxeo.agentic.records.Disposition.CERTIFICATE_SCHEMA;
import static org.nuxeo.agentic.records.Disposition.CERTIFICATE_TYPE;
import static org.nuxeo.agentic.records.Disposition.EXPORT_SCHEMA;
import static org.nuxeo.agentic.records.Disposition.EXPORT_TYPE;
import static org.nuxeo.agentic.records.Disposition.FILES;
import static org.nuxeo.agentic.records.Disposition.FILE_CONTENT;
import static org.nuxeo.agentic.records.Disposition.REQUEST_SCHEMA;
import static org.nuxeo.agentic.records.Disposition.REQUEST_TYPE;
import static org.nuxeo.agentic.records.Disposition.RUNS_SCHEMA;
import static org.nuxeo.agentic.records.Disposition.RUNS_TYPE;
import static org.nuxeo.agentic.records.Disposition.RUN_SCHEMA;
import static org.nuxeo.agentic.records.Disposition.RUN_TYPE;

import java.time.Clock;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DataModel;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.api.model.Property;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * The disposition review's one way in, and its guard: a synchronous listener on the repository's
 * document events, run in the thread of the person who caused them.
 *
 * <ul>
 * <li><b>A {@code DispositionRequest} filed</b> in the {@code DispositionRuns} folder starts a run,
 * or approves or rejects one, and the second approval disposes of it ({@link Dispositions#file}).
 * Whatever the filer wrote but the action, the run and the comment is replaced by the server's.</li>
 * <li><b>A {@code RecordsAuditExport} filed</b> there is checked, and kept for the add-on to write in
 * the background ({@link AuditExports#request}); once created, only its filer may read it.</li>
 * <li><b>Everything else</b> on the add-on's documents is refused, but the add-on's own writes
 * ({@link ServiceWrites}): a run or a certificate made by anyone else; a change to a property of the
 * add-on's schemas, to a certificate's file or to an export's files; a move, a copy, a check-in, a
 * restore or a trash;
 * and a deletion, but an administrator's. Other properties, such as a run's description, are
 * Nuxeo's to allow.</li>
 * </ul>
 *
 * A refusal throws, after marking the person's transaction for rollback, so that nothing of the
 * request is written; so does any failure while disposing of a run, whose own transaction has
 * then been rolled back.
 */
public class DispositionListener implements EventListener {

    private static final Logger log = LogManager.getLogger(DispositionListener.class);

    private final Dispositions dispositions;

    private final AuditExports exports;

    public DispositionListener() {
        this(new Dispositions(Clock.systemUTC(), Dispositions.CLUSTER), new AuditExports(Clock.systemUTC()));
    }

    DispositionListener(Dispositions dispositions, AuditExports exports) {
        this.dispositions = dispositions;
        this.exports = exports;
    }

    @Override
    public void handleEvent(Event event) {
        if (!(event.getContext() instanceof DocumentEventContext context)) {
            return;
        }
        DocumentModel doc = context.getSourceDocument();
        if (doc == null || !Disposition.TYPES.contains(doc.getType()) || ServiceWrites.active()) {
            return;
        }
        CoreSession session = context.getCoreSession();
        try {
            handle(event.getName(), session, doc);
        } catch (DispositionRefusal refusal) {
            log.warn("Disposition review: {} of a {} by {} refused, {}: {}", event.getName(), doc.getType(),
                    who(session), refusal.getStatusCode(), refusal.getCode());
            fail(event);
            throw refusal;
        } catch (RuntimeException e) {
            log.error("Disposition review: {} of a {} by {} failed; nothing of it is kept", event.getName(),
                    doc.getType(), who(session), e);
            fail(event);
            throw e;
        }
    }

    private static void fail(Event event) {
        TransactionHelper.setTransactionRollbackOnly();
        event.markBubbleException();
    }

    private void handle(String event, CoreSession session, DocumentModel doc) {
        String type = doc.getType();
        switch (event) {
        case DocumentEventTypes.ABOUT_TO_CREATE -> {
            switch (type) {
            case RUNS_TYPE -> dispositions.folderCreated(session, doc);
            case REQUEST_TYPE -> dispositions.file(session, doc);
            case EXPORT_TYPE -> exports.request(session, doc);
            default -> throw new DispositionRefusal(403, "server-only",
                    "A disposition run or certificate is written by the server alone: file a request.");
            }
        }
        case DocumentEventTypes.DOCUMENT_CREATED -> {
            if (EXPORT_TYPE.equals(type)) {
                AuditExports.restrict(session, doc);
            }
        }
        case "beforeDocumentModification" -> modified(doc);
        case DocumentEventTypes.ABOUT_TO_REMOVE -> {
            if (session == null || !session.getPrincipal().isAdministrator()) {
                throw new DispositionRefusal(403, "kept",
                        "The disposition review's documents are kept: only an administrator deletes one.");
            }
            log.warn("Disposition review: {} deletes the {} {}", who(session), type, doc.getId());
        }
        case DocumentEventTypes.ABOUT_TO_MOVE, "documentTrashed" -> {
            if (!RUNS_TYPE.equals(type) || session == null || !session.getPrincipal().isAdministrator()) {
                throw new DispositionRefusal(403, "kept",
                        "A disposition request, run or certificate stays where it was filed.");
            }
        }
        case "aboutToImport" -> throw new DispositionRefusal(403, "server-only",
                "The disposition review's documents are written by the server alone, not imported.");
        default -> throw new DispositionRefusal(403, "kept",
                "A disposition request, run or certificate is not copied, checked in or restored.");
        }
    }

    /** A change to the add-on's properties, or to a certificate's file or an export's, is the add-on's alone. */
    private static void modified(DocumentModel doc) {
        String schema = switch (doc.getType()) {
        case RUNS_TYPE -> RUNS_SCHEMA;
        case RUN_TYPE -> RUN_SCHEMA;
        case REQUEST_TYPE -> REQUEST_SCHEMA;
        case EXPORT_TYPE -> EXPORT_SCHEMA;
        default -> CERTIFICATE_SCHEMA;
        };
        DataModel own = doc.getDataModel(schema);
        boolean file = (CERTIFICATE_TYPE.equals(doc.getType()) || EXPORT_TYPE.equals(doc.getType()))
                && dirty(doc, FILE_CONTENT) || EXPORT_TYPE.equals(doc.getType()) && dirty(doc, FILES);
        if (own != null && own.isDirty() || file) {
            throw new DispositionRefusal(403, "server-only",
                    "The disposition review's properties are written by the server alone.");
        }
    }

    private static boolean dirty(DocumentModel doc, String xpath) {
        Property property = doc.getProperty(xpath);
        return property != null && property.isDirty();
    }

    private static String who(CoreSession session) {
        NuxeoPrincipal principal = session == null ? null : session.getPrincipal();
        return principal == null ? "nobody" : Dispositions.printable(principal.getName());
    }
}
