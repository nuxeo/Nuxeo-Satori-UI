/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.signature.Desk.ADMINISTRATOR;
import static org.nuxeo.agentic.signature.Desk.ALICE;
import static org.nuxeo.agentic.signature.Desk.BOB;
import static org.nuxeo.agentic.signature.Desk.PDF;
import static org.nuxeo.agentic.signature.Signatures.text;

import java.io.Serializable;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.inject.Inject;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.trash.TrashService;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * What no one but the server changes: a request once sent, but for its cancelling by its requester
 * or an administrator; a record's sgn: properties; the file out for signature; and the request,
 * the record out and the signed version, which are kept.
 */
@RunWith(FeaturesRunner.class)
@Features(SignatureFeature.class)
public class GuardTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    private StandInStub stub;

    private String caseId;

    private String requestId;

    @Before
    public void setUp() throws Exception {
        repository = core.getRepositoryName();
        stub = new StandInStub();
        Desk.configure(stub);
        Desk.create(session);
        caseId = Desk.newCase(repository, "onb-1", "agreement.pdf", "id-scan.pdf");
        requestId = Desk.send(repository, ALICE, caseId, "agreement.pdf");
    }

    @After
    public void tearDown() {
        stub.close();
    }

    private void refused(int status, String user, java.util.function.Function<CoreSession, ?> work) {
        NuxeoException e = Desk.refusedAs(repository, user, work);
        assertEquals(e.getMessage(), status, e.getStatusCode());
    }

    // ------------------------------------------------------------------ the request

    @Test
    public void aRequestIsNotChangedOnceSent() {
        for (String property : List.of(Signatures.ENVELOPE, Signatures.DOCUMENT, Signatures.STATUS)) {
            refused(400, ALICE, s -> {
                DocumentModel request = s.getDocument(new IdRef(requestId));
                request.setPropertyValue(property, "signed");
                return s.saveDocument(request);
            });
        }
        refused(400, ALICE, s -> {
            DocumentModel request = s.getDocument(new IdRef(requestId));
            request.setPropertyValue("dc:title", "Another agreement");
            return s.saveDocument(request);
        });
        refused(400, ALICE, s -> {
            DocumentModel request = s.getDocument(new IdRef(requestId));
            request.setPropertyValue(Signatures.SIGNERS,
                    (Serializable) List.of(Desk.signer("Someone Else", "someone@example.com")));
            return s.saveDocument(request);
        });
        assertEquals(Signatures.SENT, text(Desk.stored(repository, requestId), Signatures.STATUS));
    }

    @Test
    public void onlyTheRequesterOrAnAdministratorCancels() {
        // Bob may write the request, in the requests folder, and is not its requester.
        refused(403, BOB, s -> cancel(s, requestId));
        assertEquals(Signatures.SENT, text(Desk.stored(repository, requestId), Signatures.STATUS));
        assertEquals(List.of(), stub.voided);

        Desk.inTransactionAs(repository, ALICE, s -> cancel(s, requestId));
        DocumentModel request = Desk.stored(repository, requestId);
        assertEquals(Signatures.CANCELLED, text(request, Signatures.STATUS));
        assertEquals(ALICE, text(request, Signatures.CANCELLED_BY));
        assertEquals(Signatures.CANCELLED, text(Desk.stored(repository, caseId), Signatures.SGN_STATUS));
        // Voided at the provider once the cancelling committed.
        assertEquals(List.of(text(request, Signatures.ENVELOPE)), stub.voided);
        // A callback for it now is refused, and the record may be sent again.
        assertEquals(CallbackEndpoint.ENDED, Desk.callback(repository, "evt_late", "envelope.signed",
                text(request, Signatures.ENVELOPE), null));
        String again = Desk.send(repository, ALICE, caseId, "agreement.pdf");
        Desk.inTransactionAs(repository, ADMINISTRATOR, s -> cancel(s, again));
        assertEquals(Signatures.CANCELLED, text(Desk.stored(repository, again), Signatures.STATUS));
    }

    private static DocumentModel cancel(CoreSession s, String id) {
        DocumentModel request = s.getDocument(new IdRef(id));
        request.setPropertyValue(Signatures.STATUS, Signatures.CANCELLED);
        return s.saveDocument(request);
    }

    @Test
    public void aRequestIsKeptButByAnAdministratorOnceItHasEnded() {
        refused(409, ADMINISTRATOR, s -> {
            s.removeDocument(new IdRef(requestId));
            return null;
        });
        Desk.inTransactionAs(repository, ALICE, s -> cancel(s, requestId));
        refused(403, ALICE, s -> {
            s.removeDocument(new IdRef(requestId));
            return null;
        });
        refused(403, ALICE, s -> {
            Framework.getService(TrashService.class).trashDocument(s.getDocument(new IdRef(requestId)));
            return null;
        });
        Desk.inTransactionAs(repository, ADMINISTRATOR, s -> {
            s.removeDocument(new IdRef(requestId));
            return null;
        });
        assertEquals(0, Desk.requestCount(repository));
    }

    @Test
    public void aRequestIsNotCopied() {
        refused(400, ALICE, s -> s.copy(new IdRef(requestId), new org.nuxeo.ecm.core.api.PathRef(Desk.REQUESTS),
                "copy"));
        assertEquals(1, Desk.requestCount(repository));
    }

    // ------------------------------------------------------------------ the record

    @Test
    public void aRecordsSignaturePropertiesAreTheServers() {
        for (String property : List.of(Signatures.SGN_STATUS, Signatures.SGN_REQUEST, Signatures.SGN_FILE_DIGEST)) {
            refused(400, ALICE, s -> {
                DocumentModel record = s.getDocument(new IdRef(caseId));
                record.setPropertyValue(property, "signed");
                return s.saveDocument(record);
            });
        }
        refused(400, ADMINISTRATOR, s -> {
            DocumentModel record = s.getDocument(new IdRef(caseId));
            record.setPropertyValue(Signatures.SGN_EVIDENCE, (Serializable) Desk.blob("forged.json",
                    "{}".getBytes(), "application/json"));
            return s.saveDocument(record);
        });
    }

    @Test
    public void theFileOutForSignatureIsNotChangedMovedOrRemoved() {
        // Replaced.
        refused(409, ALICE, s -> {
            DocumentModel record = s.getDocument(new IdRef(caseId));
            record.setPropertyValue("files:files/0/file", (Serializable) Desk.pdf("agreement.pdf",
                    "%PDF-1.4 another".getBytes()));
            return s.saveDocument(record);
        });
        // Moved, by an attachment put before it.
        refused(409, ALICE, s -> {
            DocumentModel record = s.getDocument(new IdRef(caseId));
            Map<String, Serializable> first = new HashMap<>();
            first.put("file", (Serializable) Desk.pdf("cover.pdf", PDF));
            List<Map<String, Serializable>> files = new java.util.ArrayList<>(Stored.entries(record, "files:files"));
            files.add(0, first);
            record.setPropertyValue("files:files", (Serializable) files);
            return s.saveDocument(record);
        });
        // Removed.
        refused(409, ALICE, s -> {
            DocumentModel record = s.getDocument(new IdRef(caseId));
            record.setPropertyValue("files:files", (Serializable) List.of());
            return s.saveDocument(record);
        });
        // The rest of the record may change, the attachments after it too.
        Desk.inTransactionAs(repository, ALICE, s -> {
            DocumentModel record = s.getDocument(new IdRef(caseId));
            record.setPropertyValue("dc:description", "Waiting for the customer");
            record.setPropertyValue("files:files/1/file", (Serializable) Desk.pdf("id-scan-2.pdf", PDF));
            return s.saveDocument(record);
        });
        assertArrayEquals(PDF, Desk.bytes((Blob) Desk.stored(repository, caseId).getPropertyValue(
                "files:files/0/file")));
        // Once it has ended, it may change.
        assertEquals(CallbackEndpoint.RECEIVED, Desk.callback(repository, "evt_1", "envelope.declined",
                text(Desk.stored(repository, requestId), Signatures.ENVELOPE), null));
        Desk.inTransactionAs(repository, ALICE, s -> {
            DocumentModel record = s.getDocument(new IdRef(caseId));
            record.setPropertyValue("files:files/0/file", (Serializable) Desk.pdf("agreement-2.pdf", PDF));
            return s.saveDocument(record);
        });
    }

    @Test
    public void aRecordOutForSignatureIsNotDeletedOrTrashed() {
        refused(409, ALICE, s -> {
            Framework.getService(TrashService.class).trashDocument(s.getDocument(new IdRef(caseId)));
            return null;
        });
        refused(409, ADMINISTRATOR, s -> {
            s.removeDocument(new IdRef(caseId));
            return null;
        });
        assertFalse(Desk.stored(repository, caseId).isTrashed());
    }

    @Test
    public void aCopyOfARecordIsNotOutForSignature() {
        String copy = Desk.inTransactionAs(repository, ALICE,
                s -> s.copy(new IdRef(caseId), new org.nuxeo.ecm.core.api.PathRef(Desk.CASES), "copy").getId());
        DocumentModel copied = Desk.stored(repository, copy);
        assertNull(text(copied, Signatures.SGN_STATUS));
        assertNull(text(copied, Signatures.SGN_REQUEST));
        // And so it may be sent on its own.
        Desk.send(repository, ALICE, copy, "agreement.pdf");
    }

    @Test
    public void theVersionThatHoldsTheSignedFileIsKept() {
        assertEquals(CallbackEndpoint.RECEIVED, Desk.callback(repository, "evt_1", "envelope.signed",
                text(Desk.stored(repository, requestId), Signatures.ENVELOPE), null));
        String version = text(Desk.stored(repository, requestId), Signatures.SIGNED_VERSION);
        // Alice may remove anything of the case's, and the case has changed since, so its signed
        // version is no longer the one it was checked in as: only the add-on keeps it now.
        Desk.inTransaction(() -> org.nuxeo.ecm.core.api.CoreInstance.doPrivileged(repository, (CoreSession s) -> {
            org.nuxeo.ecm.core.api.security.ACP acp = s.getACP(new IdRef(caseId));
            acp.getOrCreateACL().add(new org.nuxeo.ecm.core.api.security.ACE(ALICE, "Everything", true));
            s.setACP(new IdRef(caseId), acp, true);
            return null;
        }));
        Desk.inTransactionAs(repository, ALICE, s -> {
            DocumentModel record = s.getDocument(new IdRef(caseId));
            record.setPropertyValue("dc:description", "Signed; account to open");
            return s.saveDocument(record);
        });
        refused(403, ALICE, s -> {
            s.removeDocument(new IdRef(version));
            return null;
        });
        assertTrue(Desk.inTransaction(() -> org.nuxeo.ecm.core.api.CoreInstance.doPrivileged(repository,
                (CoreSession s) -> s.exists(new IdRef(version)))));
        // A signed record's properties stay the server's.
        refused(400, ALICE, s -> {
            DocumentModel record = s.getDocument(new IdRef(caseId));
            record.setPropertyValue(Signatures.SGN_STATUS, Signatures.SENT);
            return s.saveDocument(record);
        });
    }
}
