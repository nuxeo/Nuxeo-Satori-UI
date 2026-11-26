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
