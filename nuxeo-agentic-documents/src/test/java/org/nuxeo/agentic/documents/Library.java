/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import java.util.List;
import java.util.function.Function;

import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.impl.ACPImpl;
import org.nuxeo.ecm.core.uidgen.UIDGeneratorService;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * The repository the tests work in, and the people who work in it.
 *
 * <pre>
 * /library            inheritance blocked: alice ReadWrite, bob Read, carol nothing
 *   /library/drawings alice's controlled documents
 *   /library/bob      bob ReadWrite: where bob may create
 *   /library/carol    carol ReadWrite: where carol may create
 * </pre>
 *
 * So bob may read alice's drawings and create a document of his own, but not write hers; carol may
 * not even read them.
 */
final class Library {

    static final String ALICE = "alice";

    static final String BOB = "bob";

    static final String CAROL = "carol";

    /** An administrator, whom the platform's permissions do not stop. */
    static final String ADMINISTRATOR = "Administrator";

    static final String DRAWINGS = "/library/drawings";

    static final String DRAWING = "ControlledDrawing";

    static final String SPEC = "ControlledSpec";

    private Library() {
    }

    /** Make the folders and their permissions, as the administrator, and commit them. */
    static void create(CoreSession admin) {
        DocumentModel library = admin.createDocument(admin.createDocumentModel("/", "library", "Workspace"));
        ACP acp = new ACPImpl();
        ACL acl = acp.getOrCreateACL();
        acl.add(new ACE(ALICE, "ReadWrite", true));
        acl.add(new ACE(BOB, "Read", true));
        acl.add(ACE.BLOCK);
        admin.setACP(library.getRef(), acp, true);
        admin.createDocument(admin.createDocumentModel("/library", "drawings", "Folder"));
        for (String user : List.of(BOB, CAROL)) {
            DocumentModel own = admin.createDocument(admin.createDocumentModel("/library", user, "Folder"));
            ACP ownAcp = new ACPImpl();
            ownAcp.getOrCreateACL().add(new ACE(user, "ReadWrite", true));
            admin.setACP(own.getRef(), ownAcp, true);
        }
        admin.save();
        nextTransaction();
    }

    // ------------------------------------------------------------------ transmittals and reviews

    /** Not a recipient, nor a reviewer, but may write where transmittals and reviews are. */
    static final String DAVE = "dave";

    /** A recipient who may read transmittals and receipts, and write none. */
    static final String ERIN = "erin";

    static final String TRANSMITTALS = "/library/transmittals";

    static final String REVIEWS = "/library/reviews";

    static final String TRANSMITTAL = "TestTransmittal";

    static final String CYCLE = "TestReviewCycle";

    /**
     * The folders transmittals and review cycles go in, below the library:
     *
     * <pre>
     * /library/transmittals  bob, carol and dave ReadWrite, erin Read (alice by the library)
     * /library/reviews       bob and dave ReadWrite (alice by the library)
     * </pre>
     *
     * So bob may write a cycle and its comments, and read the revisions, not write them.
     */
    static void createDesks(CoreSession admin) {
        DocumentModel transmittals = admin.createDocument(admin.createDocumentModel("/library", "transmittals",
                "Folder"));
        ACP acp = new ACPImpl();
        ACL acl = acp.getOrCreateACL();
        for (String user : List.of(BOB, CAROL, DAVE)) {
            acl.add(new ACE(user, "ReadWrite", true));
        }
        acl.add(new ACE(ERIN, "Read", true));
        admin.setACP(transmittals.getRef(), acp, true);
        DocumentModel reviews = admin.createDocument(admin.createDocumentModel("/library", "reviews", "Folder"));
        ACP reviewsAcp = new ACPImpl();
        reviewsAcp.getOrCreateACL().add(new ACE(BOB, "ReadWrite", true));
        reviewsAcp.getOrCreateACL().add(new ACE(DAVE, "ReadWrite", true));
        admin.setACP(reviews.getRef(), reviewsAcp, true);
        admin.save();
        nextTransaction();
    }

    /** A transmittal as the session's user issues it: subject, documents, recipients, purpose, due in days. */
    static DocumentModel issue(CoreSession session, String name, List<String> documents, List<String> recipients,
            String purpose, int dueInDays) {
        DocumentModel doc = issueModel(session, documents, recipients, purpose, dueInDays);
        doc.setPathInfo(TRANSMITTALS, name);
        return session.createDocument(doc);
    }

    /** A transmittal not yet created, in the transmittals folder. */
    static DocumentModel issueModel(CoreSession session, List<String> documents, List<String> recipients,
            String purpose, int dueInDays) {
        DocumentModel doc = session.createDocumentModel(TRANSMITTALS, "tr", TRANSMITTAL);
        doc.setPropertyValue("dc:title", "Drawings for " + purpose);
        doc.setPropertyValue(ControlledDocuments.TRM_DOCUMENTS, (java.io.Serializable) documents);
        doc.setPropertyValue(ControlledDocuments.TRM_RECIPIENTS, (java.io.Serializable) recipients);
        doc.setPropertyValue(ControlledDocuments.TRM_PURPOSE, purpose);
        doc.setPropertyValue(ControlledDocuments.TRM_DUE_DATE, day(dueInDays));
        return doc;
    }

    /** The receipts of a transmittal, by recipient, read by the administrator. */
    static java.util.Map<String, DocumentModel> receipts(String repository, String transmittalId) {
        return inTransaction(() -> CoreInstance.doPrivileged(repository, (CoreSession s) -> {
            java.util.Map<String, DocumentModel> byRecipient = new java.util.TreeMap<>();
            for (DocumentModel receipt : s.query("SELECT * FROM Document WHERE ecm:mixinType = 'TransmittalReceipt' "
                    + "AND trr:transmittal = '" + transmittalId + "' AND ecm:isVersion = 0")) {
                byRecipient.put(text(receipt, ControlledDocuments.TRR_RECIPIENT), receipt);
            }
            return byRecipient;
        }));
    }

    /** A receipt answered as the session's user. */
    static DocumentModel answer(CoreSession session, String receiptId, String status, String comment) {
        DocumentModel receipt = session.getDocument(new IdRef(receiptId));
        receipt.setPropertyValue(ControlledDocuments.TRR_STATUS, status);
        receipt.setPropertyValue(ControlledDocuments.TRR_COMMENT, comment);
        return session.saveDocument(receipt);
    }

    /** A review cycle opened as the session's user on the revision with that id. */
    static DocumentModel openCycle(CoreSession session, String name, String revisionId, List<String> reviewers) {
        DocumentModel doc = session.createDocumentModel(REVIEWS, name, CYCLE);
        doc.setPropertyValue(ControlledDocuments.RVW_DOCUMENT, revisionId);
        doc.setPropertyValue(ControlledDocuments.RVW_REVIEWERS, (java.io.Serializable) reviewers);
        return session.createDocument(doc);
    }

    /** A thread's first comment resolved, or opened again, as the session's user. */
    static DocumentModel resolve(CoreSession session, String commentId, String status, String resolution) {
        DocumentModel comment = session.getDocument(new IdRef(commentId));
        comment.setPropertyValue(ControlledDocuments.RVWC_STATUS, status);
        comment.setPropertyValue(ControlledDocuments.RVWC_RESOLUTION, resolution);
        return session.saveDocument(comment);
    }

    /** A cycle asked to close as the session's user. */
    static DocumentModel close(CoreSession session, String cycleId) {
        DocumentModel cycle = session.getDocument(new IdRef(cycleId));
        cycle.setPropertyValue(ControlledDocuments.RVW_STATUS, ControlledDocuments.CLOSED);
        return session.saveDocument(cycle);
    }

    /** A day {@code days} from today, at its UTC midnight, as Nuxeo stores a day. */
    static java.util.Calendar day(int days) {
        java.util.Calendar day = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));
        day.setTimeInMillis(TransmittalListener.startOfToday() + days * 24L * 60 * 60 * 1000);
        return day;
    }

    /** Start the series again from 1, so a test can name the numbers it expects. */
    static void resetSeries(String... ids) {
        for (String id : ids) {
            NumberSeries series = Framework.getService(ControlledDocumentService.class).series(id);
            Framework.getService(UIDGeneratorService.class).getSequencer().initSequence(series.sequenceKey(), 0L);
        }
    }

    static NuxeoPrincipal principal(String user) {
        return ADMINISTRATOR.equals(user) ? new UserPrincipal(user, List.of("administrators"), false, true)
                : new UserPrincipal(user, List.of("members"), false, false);
    }

    /** The refusal a piece of work as the user gets, in a transaction of its own, rolled back. */
    static org.nuxeo.ecm.core.api.NuxeoException refusedAs(String repository, String user,
            Function<CoreSession, ?> work) {
        try {
            inTransactionAs(repository, user, work);
        } catch (org.nuxeo.ecm.core.api.NuxeoException e) {
            return e;
        }
        throw new AssertionError("not refused");
    }

    /** A session as the user, in the thread's current transaction. */
    static CoreSession as(String repository, String user) {
        return CoreInstance.getCoreSession(repository, principal(user));
    }

    /** Run something as the user, in a transaction of its own, committed unless it throws. */
    static <T> T inTransactionAs(String repository, String user, Function<CoreSession, T> work) {
        return inTransaction(() -> work.apply(as(repository, user)));
    }

    /**
     * Run something in a transaction of its own, committed unless it throws, and rolled back if
     * it does. The test's own transaction is committed first and another started after:
     * {@code runInTransaction} joins a transaction already active, and would neither commit nor
     * roll back on its own.
     */
    static <T> T inTransaction(java.util.function.Supplier<T> work) {
        if (TransactionHelper.isTransactionActiveOrMarkedRollback()) {
            TransactionHelper.commitOrRollbackTransaction();
        }
        try {
            return TransactionHelper.runInTransaction(work);
        } finally {
            TransactionHelper.startTransaction();
        }
    }

    /** A new controlled document in the folder, its first revision in the series. */
    static DocumentModel first(CoreSession session, String folder, String type, String name, String series) {
        DocumentModel doc = session.createDocumentModel(folder, name, type);
        doc.setPropertyValue("dc:title", name);
        doc.setPropertyValue(ControlledDocuments.SERIES, series);
        return session.createDocument(doc);
    }

    /** A new revision in the folder, superseding the document with that id. */
    static DocumentModel revise(CoreSession session, String folder, String type, String name, String supersedes) {
        DocumentModel doc = session.createDocumentModel(folder, name, type);
        doc.setPropertyValue("dc:title", name);
        doc.setPropertyValue(ControlledDocuments.SUPERSEDES, supersedes);
        return session.createDocument(doc);
    }

    /** The document as stored, read by the administrator in a transaction of its own. */
    static DocumentModel stored(String repository, String id) {
        return inTransaction(() -> CoreInstance.doPrivileged(repository, (CoreSession s) -> s.exists(new IdRef(id))
                ? s.getDocument(new IdRef(id))
                : null));
    }

    static String text(DocumentModel doc, String xpath) {
        return ControlledDocuments.text(doc, xpath);
    }

    /** Commit the thread's transaction, and start another. */
    static void nextTransaction() {
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
    }
}
