package org.nuxeo.agentic.records;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.ecm.core.model.BaseSession;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * A legal hold's guard, beyond the platform's ({@link LegalHolds}): a synchronous listener on the
 * repository's document events, run in the thread of the person who caused them. For a document
 * under a legal hold, it refuses, whoever asks, an administrator included:
 *
 * <ul>
 * <li>putting it in the trash, and deleting it. The platform refuses a person both before any event,
 * as its security policy takes {@code Remove} away on a held document; an administrator's trash it
 * lets through, and their deletion it refuses after this listener, in the repository;</li>
 * <li>putting in the trash, or deleting, a folder that holds one at any depth, since the repository
 * takes a folder's documents along, and the trash puts them in the trash after it, in the
 * background;</li>
 * <li>a change to its files, its main file or its attachments. Its other properties stay editable,
 * as the platform keeps them. Restoring it to a version, which would write its files over, the
 * platform refuses on any record.</li>
 * </ul>
 *
 * The add-on's own writes ({@link ServiceWrites}) are passed over, so that a disposition run meets
 * the platform's own guard, as it always has; so is whom the platform lets delete what it keeps
 * ({@code BaseSession.canDeleteUndeletable}): the members of {@code NuxeoRecordCleaners} outside
 * compliance mode, and everyone while the server's {@code org.nuxeo.core.allowDeleteUndeletableDocuments}
 * is on. Versions and proxies are passed over: a hold is the live document's. A refusal marks the
 * person's transaction for rollback, and throws a 409 with the code {@code held}, so that nothing of
 * the request is written.
 */
public class HoldListener implements EventListener {

    private static final Logger log = LogManager.getLogger(HoldListener.class);

    @Override
    public void handleEvent(Event event) {
        if (!(event.getContext() instanceof DocumentEventContext context)) {
            return;
        }
        DocumentModel doc = context.getSourceDocument();
        if (doc == null || doc.isProxy() || doc.isVersion() || ServiceWrites.active() || doc.getRef() == null) {
            return;
        }
        CoreSession session = context.getCoreSession();
        if (session == null || session.getPrincipal() == null) {
            return;
        }
        // The platform's own record cleaners, whom it lets delete what it keeps: the members of
        // NuxeoRecordCleaners outside compliance mode, or everyone while the server's
        // org.nuxeo.core.allowDeleteUndeletableDocuments is on. They pass the platform's guard, and
        // pass this one.
        if (BaseSession.canDeleteUndeletable(session.getPrincipal())) {
            return;
        }
        DispositionRefusal refusal = refusal(event.getName(), session, doc);
        if (refusal == null) {
            return;
        }
        log.warn("Legal hold: {} of the {} {} by {} refused, {}", event.getName(), doc.getType(), doc.getId(),
                who(session), refusal.getCode());
        TransactionHelper.setTransactionRollbackOnly();
        event.markBubbleException();
        throw refusal;
    }

    /** What the event would do that a hold forbids, or {@code null} when it forbids nothing of it. */
    private static DispositionRefusal refusal(String event, CoreSession session, DocumentModel doc) {
        switch (event) {
        case DocumentEventTypes.ABOUT_TO_REMOVE, "documentTrashed" -> {
            if (LegalHolds.held(session, doc)) {
                return LegalHolds.refusal(LegalHolds.RECORD_HELD);
            }
            if (doc.isFolder() && LegalHolds.holdsHeld(session, doc)) {
                return LegalHolds.refusal(LegalHolds.FOLDER_HELD);
            }
            return null;
        }
        case "beforeDocumentModification" -> {
            return LegalHolds.filesChange(doc) && LegalHolds.held(session, doc)
                    ? LegalHolds.refusal(LegalHolds.FILES_HELD)
                    : null;
        }
        default -> {
            return null;
        }
        }
    }

    private static String who(CoreSession session) {
        NuxeoPrincipal principal = session.getPrincipal();
        return principal == null ? "nobody" : Dispositions.printable(principal.getName());
    }
}
