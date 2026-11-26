package org.nuxeo.agentic.records;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.records.Fixtures.commit;
import static org.nuxeo.agentic.records.Fixtures.daysAgo;
import static org.nuxeo.agentic.records.Fixtures.decide;
import static org.nuxeo.agentic.records.Fixtures.ended;
import static org.nuxeo.agentic.records.Fixtures.refused;
import static org.nuxeo.agentic.records.Fixtures.start;

import java.io.Serializable;

import org.junit.Test;
import org.nuxeo.ecm.core.api.Blobs;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.security.ACE;
import org.nuxeo.ecm.core.api.security.ACL;
import org.nuxeo.ecm.core.api.security.ACP;
import org.nuxeo.ecm.core.api.security.SecurityConstants;

/**
 * The add-on's documents are its own: no one else, an administrator included, writes a run, a
 * certificate or a request's outcome, moves or copies one, and only an administrator deletes one.
 */
public class DispositionGuardTest extends DispositionTestCase {

    private DocumentModel disposedRun() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        decide(session, "bob", run, Disposition.APPROVE);
        decide(session, "carol", run, Disposition.APPROVE);
        return session.getDocument(run.getRef());
    }

    @Test
    public void aRunIsWrittenByTheServerAlone() {
        CoreSession alice = Fixtures.as(session, "alice");
        assertEquals("server-only", refused(() -> alice.createDocument(
                alice.createDocumentModel(Fixtures.RUNS, "forged", Disposition.RUN_TYPE))));
        assertEquals("server-only", refused(() -> session.createDocument(
                session.createDocumentModel(Fixtures.RUNS, "forged", Disposition.RUN_TYPE))));
    }

    @Test
    public void aRunsStateIsTheServersEvenForAnAdministrator() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        DocumentModel edited = session.getDocument(run.getRef());
        edited.setPropertyValue(Disposition.RUN_STATE, Disposition.DISPOSED);
        assertEquals("server-only", refused(() -> session.saveDocument(edited)));
        Fixtures.assertState(session, run, Disposition.PENDING);

        // A property that is not the add-on's is Nuxeo's to allow.
        DocumentModel described = session.getDocument(run.getRef());
        described.setPropertyValue("dc:description", "The first run of the year");
        session.saveDocument(described);
        commit(session);
    }

    @Test
    public void aCertificateIsTheServersAndItsFileCannotBeReplaced() {
        DocumentModel run = disposedRun();
        assertEquals("server-only", refused(() -> session.createDocument(
                session.createDocumentModel(Fixtures.RUNS, "forged", Disposition.CERTIFICATE_TYPE))));

        DocumentModel certificate = session.getDocument(new IdRef((String) run.getPropertyValue(Disposition.RUN_CERTIFICATE)));
        certificate.setPropertyValue(Disposition.FILE_CONTENT, (Serializable) Blobs.createBlob("forged"));
        assertEquals("server-only", refused(() -> session.saveDocument(certificate)));

        DocumentModel again = session.getDocument(certificate.getRef());
        again.setPropertyValue(Disposition.CERT_SHA256, "0".repeat(64));
        assertEquals("server-only", refused(() -> session.saveDocument(again)));
    }

    @Test
    public void aRequestsOutcomeCannotBeRewritten() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        commit(session);
        DocumentModel run = start(session, "alice");
        DocumentModel approval = decide(session, "bob", run, Disposition.APPROVE);
        approval.setPropertyValue(Disposition.REQUEST_OUTCOME, Disposition.DISPOSED);
        assertEquals("server-only", refused(() -> session.saveDocument(approval)));
    }

    @Test
    public void onlyAnAdministratorDeletesADispositionDocument() {
        DocumentModel run = disposedRun();
        // frank holds Everything on the folder, Remove included: the add-on, not Nuxeo, refuses him.
        ACP acp = session.getACP(folder.getRef());
        acp.getACL(ACL.LOCAL_ACL).add(0, new ACE("frank", SecurityConstants.EVERYTHING, true));
        session.setACP(folder.getRef(), acp, true);
        commit(session);
        CoreSession frank = Fixtures.as(session, "frank");
        String certificate = (String) run.getPropertyValue(Disposition.RUN_CERTIFICATE);
        assertEquals("kept", refused(() -> {
            frank.removeDocument(new IdRef(certificate));
            return null;
        }));
        assertEquals("kept", refused(() -> {
            frank.removeDocument(run.getRef());
            return null;
        }));
        assertTrue(session.exists(new IdRef(certificate)));

        session.removeDocument(run.getRef());
        commit(session);
        assertTrue(!session.exists(run.getRef()));
    }

    @Test
    public void aRunIsNeitherCopiedNorMoved() {
        DocumentModel run = disposedRun();
        DocumentModel elsewhere = session.createDocument(session.createDocumentModel("/", "elsewhere", "Folder"));
        commit(session);
        assertEquals("kept", refused(() -> session.copy(run.getRef(), elsewhere.getRef(), "copy")));
        assertEquals("kept", refused(() -> session.move(run.getRef(), elsewhere.getRef(), "moved")));
        assertEquals(folder.getRef(), session.getDocument(run.getRef()).getParentRef());
    }

    @Test
    public void aRepositoryHasOneRunsFolderAndOnlyAnAdministratorMakesIt() {
        assertEquals("folder-exists", refused(() -> session.createDocument(
                session.createDocumentModel("/", "another", Disposition.RUNS_TYPE))));

        session.removeDocument(folder.getRef());
        ACP acp = session.getACP(new org.nuxeo.ecm.core.api.PathRef("/"));
        acp.getOrCreateACL(ACL.LOCAL_ACL).add(new ACE("dave", SecurityConstants.EVERYTHING, true));
        session.setACP(new org.nuxeo.ecm.core.api.PathRef("/"), acp, true);
        commit(session);
        CoreSession dave = Fixtures.as(session, "dave");
        assertEquals("administrators-only", refused(() -> dave.createDocument(
                dave.createDocumentModel("/", "mine", Disposition.RUNS_TYPE))));
    }

    /**
     * At the root, so that no one but an administrator deletes, trashes, moves or copies a folder
     * above it: the repository removes a folder's contents with no event of their own.
     */
    @Test
    public void theRunsFolderIsMadeAtTheRoot() {
        session.removeDocument(folder.getRef());
        DocumentModel area = session.createDocument(session.createDocumentModel("/", "area", "Folder"));
        commit(session);
        assertEquals("not-at-root", refused(() -> session.createDocument(
                session.createDocumentModel(area.getPathAsString(), "runs", Disposition.RUNS_TYPE))));
    }

    @Test
    public void aRunsFolderMovedFromTheRootTakesNoRequest() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        DocumentModel area = session.createDocument(session.createDocumentModel("/", "area", "Folder"));
        commit(session);
        session.move(folder.getRef(), area.getRef(), null);
        commit(session);
        DocumentModel moved = session.getDocument(folder.getRef());
        CoreSession alice = Fixtures.as(session, "alice");
        DocumentModel request = alice.createDocumentModel(moved.getPathAsString(), "start", Disposition.REQUEST_TYPE);
        request.setPropertyValue(Disposition.REQUEST_ACTION, Disposition.START);
        assertEquals("folder-misplaced", refused(() -> alice.createDocument(request)));
    }

    @Test
    public void aFolderThatInheritsPermissionsTakesNoRequest() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        ACP acp = session.getACP(folder.getRef());
        ACL local = acp.getACL(ACL.LOCAL_ACL);
        local.remove(ACE.BLOCK);
        session.setACP(folder.getRef(), acp, true);
        commit(session);
        assertEquals("folder-inherits", refused(() -> start(session, "alice")));
    }

    @Test
    public void aRequestIsFiledInTheRunsFolderAlone() {
        ended(session, "Claim 1001", rule, daysAgo(10));
        DocumentModel elsewhere = session.createDocument(session.createDocumentModel("/", "elsewhere", "Folder"));
        ACP acp = session.getACP(elsewhere.getRef());
        acp.getOrCreateACL(ACL.LOCAL_ACL).add(new ACE("alice", SecurityConstants.EVERYTHING, true));
        session.setACP(elsewhere.getRef(), acp, true);
        commit(session);
        CoreSession alice = Fixtures.as(session, "alice");
        DocumentModel request = alice.createDocumentModel("/elsewhere", "start", Disposition.REQUEST_TYPE);
        request.setPropertyValue(Disposition.REQUEST_ACTION, Disposition.START);
        assertEquals("not-in-runs-folder", refused(() -> alice.createDocument(request)));
    }
}
