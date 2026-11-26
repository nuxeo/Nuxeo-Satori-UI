/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.nuxeo.agentic.signature.Desk.ALICE;
import static org.nuxeo.agentic.signature.Desk.BOB;
import static org.nuxeo.agentic.signature.Desk.CAROL;
import static org.nuxeo.agentic.signature.Desk.ONE_SIGNER;
import static org.nuxeo.agentic.signature.Desk.PDF;
import static org.nuxeo.agentic.signature.Desk.signer;
import static org.nuxeo.agentic.signature.Signatures.text;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import javax.inject.Inject;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Sending: a request's file goes to the provider when the request is created, by someone who may
 * write its record, and the record is marked out for signature; every request that should not be
 * sent is refused, with nothing sent and nothing saved.
 */
@RunWith(FeaturesRunner.class)
@Features(SignatureFeature.class)
public class SendTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    private StandInStub stub;

    @Before
    public void setUp() throws Exception {
        repository = core.getRepositoryName();
        stub = new StandInStub();
        Desk.configure(stub);
        Desk.create(session);
    }

    @After
    public void tearDown() {
        stub.close();
    }

    @Test
    public void aRequestSendsTheAttachmentItNamesAndMarksTheRecordOutForSignature() {
        String caseId = Desk.newCase(repository, "onb-1", "id-scan.pdf", "agreement.pdf");
        List<Map<String, Serializable>> signers = List.of(signer(" Rowan Vale ", "rowan.vale@example.com"),
                signer("Ines Marlow", "ines.marlow@example.org"));
        String requestId = Desk.inTransactionAs(repository, ALICE,
                s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", signers)).getId());

        DocumentModel request = Desk.stored(repository, requestId);
        assertEquals(Signatures.SENT, text(request, Signatures.STATUS));
        assertEquals("standin", text(request, Signatures.PROVIDER));
        String envelope = text(request, Signatures.ENVELOPE);
        assertEquals("env_1", envelope);
        assertEquals("files:files/1/file", text(request, Signatures.FILE));
        assertEquals("agreement.pdf", text(request, Signatures.SENT_FILE_NAME));
        assertEquals(StandInStub.sha256(PDF), text(request, Signatures.SENT_DIGEST));
        assertEquals(ALICE, text(request, Signatures.REQUESTED_BY));
        assertNotNull(request.getPropertyValue(Signatures.REQUESTED_AT));

        // What the service was given: the file, its digest, the signers, trimmed, and the subject.
        StandInStub.Sent sent = stub.envelope(envelope);
        assertArrayEquals(PDF, sent.content());
        assertEquals(StandInStub.sha256(PDF), sent.body().path("document").path("sha256").asText());
        assertEquals("agreement.pdf", sent.body().path("document").path("fileName").asText());
        assertEquals("Account agreement", sent.body().path("subject").asText());
        assertEquals("Rowan Vale", sent.body().path("signers").get(0).path("name").asText());
        assertEquals("ines.marlow@example.org", sent.body().path("signers").get(1).path("email").asText());

        DocumentModel record = Desk.stored(repository, caseId);
        assertEquals(Signatures.SENT, text(record, Signatures.SGN_STATUS));
        assertEquals(requestId, text(record, Signatures.SGN_REQUEST));
        assertEquals(List.of("Rowan Vale", "Ines Marlow"),
                Arrays.asList((String[]) record.getPropertyValue(Signatures.SGN_SIGNERS)));
        assertEquals("files:files/1/file", text(record, Signatures.SGN_FILE));
        assertNotNull(text(record, Signatures.SGN_FILE_DIGEST));
        // Marked, with no version made of it.
        assertEquals(List.of(), Desk.versions(repository, caseId));
    }

    @Test
    public void withNoFileNamedTheRecordsMainFileIsSent() {
        String id = Desk.newRecord(repository, "TestAgreement", "agreement", PDF, "application/pdf");
        String requestId = Desk.send(repository, ALICE, id, null);
        assertEquals("file:content", text(Desk.stored(repository, requestId), Signatures.FILE));
        assertEquals(1, stub.envelopeCount());
    }

    // ------------------------------------------------------------------ permissions

    @Test
    public void someoneWhoMayReadTheRecordButNotWriteItIsRefused() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        refused(403, BOB, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER)));
    }

    @Test
    public void someoneWhoMayNotReadTheRecordIsRefused() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        // Carol may create nowhere on the desk either: given a folder of her own, she still may not read the case.
        Desk.inTransaction(() -> org.nuxeo.ecm.core.api.CoreInstance.doPrivileged(repository, (CoreSession s) -> {
            DocumentModel own = s.createDocument(s.createDocumentModel("/", "carol", "Folder"));
            org.nuxeo.ecm.core.api.security.ACP acp = new org.nuxeo.ecm.core.api.security.impl.ACPImpl();
            acp.getOrCreateACL().add(new org.nuxeo.ecm.core.api.security.ACE(CAROL, "ReadWrite", true));
            s.setACP(own.getRef(), acp, true);
            return null;
        }));
        refused(403, CAROL, s -> {
            DocumentModel doc = Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER);
            doc.setPathInfo("/carol", "request");
            return s.createDocument(doc);
        });
    }

    // ------------------------------------------------------------------ the record and its file

    @Test
    public void aRecordThatCannotBeSignedIsRefused() {
        String id = Desk.newRecord(repository, "TestPlain", "plain", PDF, "application/pdf");
        refused(400, ALICE, s -> s.createDocument(Desk.requestModel(s, id, null, ONE_SIGNER)));
    }

    @Test
    public void aRecordThatKeepsNoVersionsIsRefused() {
        String id = Desk.newRecord(repository, "TestUnversioned", "unversioned", PDF, "application/pdf");
        refused(400, ALICE, s -> s.createDocument(Desk.requestModel(s, id, "unversioned.pdf", ONE_SIGNER)));
    }

    @Test
    public void anAttachmentTheRecordDoesNotHaveIsRefused() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        refused(400, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "other.pdf", ONE_SIGNER)));
        refused(400, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, null, ONE_SIGNER)));
    }

    @Test
    public void twoAttachmentsOfTheNameAreRefused() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf", "agreement.pdf");
        refused(409, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER)));
    }

    @Test
    public void aFileTheProviderDoesNotTakeIsRefused() {
        String word = Desk.newRecord(repository, "TestAgreement", "word", "not a pdf".getBytes(),
                "application/msword");
        refused(400, ALICE, s -> s.createDocument(Desk.requestModel(s, word, null, ONE_SIGNER)));
        // Said to be a PDF, and not one.
        String fake = Desk.newRecord(repository, "TestAgreement", "fake", "not a pdf".getBytes(), "application/pdf");
        refused(400, ALICE, s -> s.createDocument(Desk.requestModel(s, fake, null, ONE_SIGNER)));
    }

    // ------------------------------------------------------------------ the request

    @Test
    public void signersAreOneToTenEachWithANameAndAnAddressOnce() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        refused(400, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", List.of())));
        refused(400, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf",
                List.of(signer("Rowan Vale", "not-an-address")))));
        refused(400, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf",
                List.of(signer("", "rowan.vale@example.com")))));
        refused(400, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf",
                List.of(signer("Rowan Vale", "rowan.vale@example.com"),
                        signer("Rowan Vale again", "Rowan.Vale@example.com")))));
        List<Map<String, Serializable>> eleven = new ArrayList<>();
        for (int i = 0; i < 11; i++) {
            eleven.add(signer("Signer " + i, "signer" + i + "@example.com"));
        }
        refused(400, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", eleven)));
    }

    @Test
    public void whatTheServerWritesIsNotGivenByTheRequester() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        for (String property : List.of(Signatures.STATUS, Signatures.ENVELOPE, Signatures.SIGNED_VERSION,
                Signatures.REQUESTED_BY)) {
            refused(400, ALICE, s -> {
                DocumentModel doc = Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER);
                doc.setPropertyValue(property, "signed");
                return s.createDocument(doc);
            });
        }
    }

    @Test
    public void aRecordOutForSignatureIsNotSentAgain() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        Desk.send(repository, ALICE, caseId, "agreement.pdf");
        refused(409, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER)));
    }

    /** Another send of the record under way, on this node or another: the claim refuses this one. */
    @Test
    public void aRecordBeingSentAtThisMomentIsNotSentTwice() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        SignatureService service = org.nuxeo.runtime.api.Framework.getService(SignatureService.class);
        assertTrue(service.claim(SignatureRequestListener.openKey(caseId), "another send", 60, false));
        refused(409, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER)));
        service.release(SignatureRequestListener.openKey(caseId));
        Desk.send(repository, ALICE, caseId, "agreement.pdf");
        assertEquals(1, stub.envelopeCount());
    }

    /**
     * The file changed, and committed, by another transaction while the service took the old one:
     * the send's transaction does not see it. Filing does: the signed old file goes beside the new
     * one, and nothing is written over it.
     */
    @Test
    public void aFileChangedWhileItIsSentIsNotWrittenOver() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        byte[] meanwhile = "%PDF-1.4 changed meanwhile".getBytes();
        stub.onSend = () -> TransactionHelper.runInTransaction(() -> org.nuxeo.ecm.core.api.CoreInstance.doPrivileged(
                repository, (CoreSession s) -> {
                    DocumentModel record = s.getDocument(new org.nuxeo.ecm.core.api.IdRef(caseId));
                    record.setPropertyValue("files:files/0/file", (Serializable) Desk.pdf("agreement.pdf", meanwhile));
                    return s.saveDocument(record);
                }));
        String requestId = Desk.send(repository, ALICE, caseId, "agreement.pdf");
        stub.onSend = null;
        String envelope = text(Desk.stored(repository, requestId), Signatures.ENVELOPE);
        assertArrayEquals(PDF, stub.envelope(envelope).content());

        assertEquals(CallbackEndpoint.RECEIVED, Desk.callback(repository, "evt_1", "envelope.signed", envelope, null));
        DocumentModel record = Desk.stored(repository, caseId);
        assertArrayEquals(meanwhile, Desk.bytes((org.nuxeo.ecm.core.api.Blob) record.getPropertyValue(
                "files:files/0/file")));
        assertArrayEquals(StandInStub.signed(PDF, envelope), Desk.bytes((org.nuxeo.ecm.core.api.Blob)
                record.getPropertyValue("files:files/1/file")));
        assertEquals("files:files/1/file", text(record, Signatures.SGN_FILE));
        assertEquals(1, Desk.versions(repository, caseId).size());
    }

    @Test
    public void aRecordsSignaturePropertiesAreNotGivenWhenItIsCreated() {
        refused(400, ALICE, s -> {
            DocumentModel doc = s.createDocumentModel(Desk.CASES, "forged", "TestCase");
            doc.setPropertyValue(Signatures.SGN_STATUS, Signatures.SIGNED);
            return s.createDocument(doc);
        }, 0);
    }

    // ------------------------------------------------------------------ the provider

    @Test
    public void withNoProviderConfiguredNothingIsSent() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        Map<String, String> properties = Desk.configure(stub);
        properties.remove(SignatureSettings.PROVIDER_PROPERTY);
        Desk.use(properties);
        refused(503, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER)));
        // Named, and missing its callback secret: not configured either.
        properties.put(SignatureSettings.PROVIDER_PROPERTY, "standin");
        properties.remove("nuxeo.agentic.signature.standin.callbackSecret");
        Desk.use(properties);
        refused(503, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER)));
        // A secret too short to be one.
        properties.put("nuxeo.agentic.signature.standin.callbackSecret", "short");
        Desk.use(properties);
        refused(503, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER)));
        // Plain http, not allowed.
        properties.put("nuxeo.agentic.signature.standin.callbackSecret", StandInStub.SECRET);
        properties.remove("nuxeo.agentic.signature.standin.http.allowed");
        Desk.use(properties);
        refused(503, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER)));
    }

    @Test
    public void aServiceThatFailsSavesNothing() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        stub.mode = StandInStub.Mode.SEND_FAILS;
        refused(503, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER)), 1);
        assertNull(text(Desk.stored(repository, caseId), Signatures.SGN_STATUS));
        // The claim on the record went with the transaction: it may be sent once the service is back.
        stub.mode = StandInStub.Mode.NORMAL;
        Desk.send(repository, ALICE, caseId, "agreement.pdf");
        assertEquals(1, stub.envelopeCount());
    }

    @Test
    public void aServiceThatRedirectsIsNotFollowed() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        stub.mode = StandInStub.Mode.REDIRECT;
        refused(503, ALICE, s -> s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER)), 1);
    }

    @Test
    public void anEnvelopeWhoseRequestIsNotSavedIsVoided() {
        String caseId = Desk.newCase(repository, "onb-1", "agreement.pdf");
        NuxeoException e = Desk.refusedAs(repository, ALICE, s -> {
            s.createDocument(Desk.requestModel(s, caseId, "agreement.pdf", ONE_SIGNER));
            throw new NuxeoException("something after the send fails");
        });
        assertEquals("something after the send fails", e.getMessage());
        assertEquals(List.of("env_1"), stub.voided);
        assertEquals(0, Desk.requestCount(repository));
        assertNull(text(Desk.stored(repository, caseId), Signatures.SGN_STATUS));
    }

    /** Refused with the status, nothing saved, and the service asked nothing. */
    private void refused(int status, String user, Function<CoreSession, ?> work) {
        refused(status, user, work, 0);
    }

    private void refused(int status, String user, Function<CoreSession, ?> work, int calls) {
        long before = Desk.requestCount(repository);
        stub.requests.clear();
        NuxeoException e = Desk.refusedAs(repository, user, work);
        assertEquals(e.getMessage(), status, e.getStatusCode());
        assertEquals(before, Desk.requestCount(repository));
        assertEquals(stub.requests.toString(), calls, stub.requests.size());
        assertTrue(TransactionHelper.isTransactionActive());
    }
}
