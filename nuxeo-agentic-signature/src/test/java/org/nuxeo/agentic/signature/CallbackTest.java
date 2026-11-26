/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.nuxeo.agentic.signature.Desk.ALICE;
import static org.nuxeo.agentic.signature.Desk.PDF;
import static org.nuxeo.agentic.signature.Signatures.text;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
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
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * The provider's callback: only an authenticated, fresh one, taken once, ends a request; signed,
 * the signed file is filed on the record as a new major version with the provider's evidence;
 * declined, the request and the record say so. Everything else is refused and changes nothing.
 */
@RunWith(FeaturesRunner.class)
@Features(SignatureFeature.class)
public class CallbackTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private String repository;

    private StandInStub stub;

    private String caseId;

    private String requestId;

    private String envelope;

    @Before
    public void setUp() throws Exception {
        repository = core.getRepositoryName();
        stub = new StandInStub();
        Desk.configure(stub);
        Desk.create(session);
        caseId = Desk.newCase(repository, "onb-1", "id-scan.pdf", "agreement.pdf");
        requestId = Desk.send(repository, ALICE, caseId, "agreement.pdf");
        envelope = text(Desk.stored(repository, requestId), Signatures.ENVELOPE);
        stub.requests.clear();
    }

    @After
    public void tearDown() {
        stub.close();
    }

    private CallbackEndpoint.Response signed(String eventId) {
        return Desk.callback(repository, eventId, "envelope.signed", envelope, null);
    }

    // ------------------------------------------------------------------ signed and declined

    @Test
    public void signedFilesTheSignedFileOnTheRecordAsANewVersionWithTheEvidence() {
        assertEquals(CallbackEndpoint.RECEIVED, signed("evt_1"));

        byte[] signedBytes = StandInStub.signed(PDF, envelope);
        DocumentModel request = Desk.stored(repository, requestId);
        assertEquals(Signatures.SIGNED, text(request, Signatures.STATUS));
        assertEquals("evt_1", text(request, Signatures.EVENT));
        assertNotNull(request.getPropertyValue(Signatures.COMPLETED_AT));
        assertEquals(StandInStub.sha256(signedBytes), text(request, Signatures.SIGNED_DIGEST));
        assertArrayEquals(signedBytes, Desk.bytes((Blob) request.getPropertyValue(Signatures.SIGNED_FILE)));
        assertArrayEquals(StandInStub.evidence(envelope),
                Desk.bytes((Blob) request.getPropertyValue(Signatures.EVIDENCE)));
        assertEquals(StandInStub.sha256(StandInStub.evidence(envelope)),
                text(request, Signatures.EVIDENCE_DIGEST));
        // Fetched from the service with the server's key, after the callback said so.
        assertEquals(List.of("GET /envelopes/" + envelope + "/result"), stub.requests);

        // The record: the signed file in the sent file's place, the other attachment as it was.
        DocumentModel record = Desk.stored(repository, caseId);
        Blob filed = (Blob) record.getPropertyValue("files:files/1/file");
        assertArrayEquals(signedBytes, Desk.bytes(filed));
        assertEquals("agreement-signed.pdf", filed.getFilename());
        assertEquals("id-scan.pdf", ((Blob) record.getPropertyValue("files:files/0/file")).getFilename());
        assertEquals(Signatures.SIGNED, text(record, Signatures.SGN_STATUS));
        assertNotNull(record.getPropertyValue(Signatures.SGN_COMPLETED_AT));

        // A major version, which the request names, holding the signed file and the evidence.
        List<DocumentModel> versions = Desk.versions(repository, caseId);
        assertEquals(1, versions.size());
        DocumentModel version = versions.get(0);
        assertEquals("1.0", version.getVersionLabel());
        assertEquals(version.getId(), text(request, Signatures.SIGNED_VERSION));
        assertArrayEquals(signedBytes, Desk.bytes((Blob) version.getPropertyValue("files:files/1/file")));
        assertArrayEquals(StandInStub.evidence(envelope),
                Desk.bytes((Blob) version.getPropertyValue(Signatures.SGN_EVIDENCE)));
        assertEquals(Signatures.SIGNED, text(version, Signatures.SGN_STATUS));
    }

    @Test
    public void theMainFileIsFiledInItsPlace() {
        String agreement = Desk.newRecord(repository, "TestAgreement", "agreement", PDF, "application/pdf");
        String request = Desk.send(repository, ALICE, agreement, null);
        String sent = text(Desk.stored(repository, request), Signatures.ENVELOPE);
        assertEquals(CallbackEndpoint.RECEIVED, Desk.callback(repository, "evt_main", "envelope.signed", sent, null));
        DocumentModel record = Desk.stored(repository, agreement);
        assertArrayEquals(StandInStub.signed(PDF, sent), Desk.bytes((Blob) record.getPropertyValue("file:content")));
        assertEquals(1, Desk.versions(repository, agreement).size());
    }

    @Test
    public void declinedEndsTheRequestWithTheReasonAndFilesNothing() {
        assertEquals(CallbackEndpoint.RECEIVED,
                Desk.callback(repository, "evt_1", "envelope.declined", envelope, "Wrong address\u0007 on page 2"));
        DocumentModel request = Desk.stored(repository, requestId);
        assertEquals(Signatures.DECLINED, text(request, Signatures.STATUS));
        // Control characters dropped.
        assertEquals("Wrong address on page 2", text(request, Signatures.DECLINE_REASON));
        assertNull(request.getPropertyValue(Signatures.SIGNED_VERSION));
        DocumentModel record = Desk.stored(repository, caseId);
        assertEquals(Signatures.DECLINED, text(record, Signatures.SGN_STATUS));
        assertArrayEquals(PDF, Desk.bytes((Blob) record.getPropertyValue("files:files/1/file")));
        assertEquals(List.of(), Desk.versions(repository, caseId));
        assertEquals(List.of(), stub.requests);
        // No longer out: it may be sent again.
        Desk.send(repository, ALICE, caseId, "agreement.pdf");
    }

    @Test
    public void anotherEventIsTakenAndChangesNothing() {
        assertEquals(CallbackEndpoint.RECEIVED, Desk.callback(repository, "evt_1", "envelope.viewed", envelope, null));
        assertEquals(Signatures.SENT, text(Desk.stored(repository, requestId), Signatures.STATUS));
    }

    // ------------------------------------------------------------------ authentication

    @Test
    public void aCallbackNotSignedWithTheSecretIsRefused() {
        byte[] body = StandInStub.callbackBody("evt_1", "envelope.signed", envelope, null);
        long now = Clock.systemUTC().instant().getEpochSecond();
        // Another secret.
        unchanged(Desk.post(repository, StandInStub.signedHeaders("another-secret-0123456789abcdef-0123456789",
                now, body), body), CallbackEndpoint.REFUSED);
        // The body changed after it was signed.
        byte[] other = StandInStub.callbackBody("evt_1", "envelope.signed", "env_2", null);
        unchanged(Desk.post(repository, StandInStub.signedHeaders(StandInStub.SECRET, now, body), other),
                CallbackEndpoint.REFUSED);
        // The time changed after it was signed.
        Map<String, String> moved = new HashMap<>(StandInStub.signedHeaders(StandInStub.SECRET, now, body));
        String header = moved.get("x-standin-signature");
        moved.put("x-standin-signature", header.replace("t=" + now, "t=" + (now + 1)));
        unchanged(Desk.post(repository, moved, body), CallbackEndpoint.REFUSED);
        // No signature, one in another form, and one cut short.
        unchanged(Desk.post(repository, Map.of(), body), CallbackEndpoint.REFUSED);
        unchanged(Desk.post(repository, Map.of("x-standin-signature", "sha256=" + "0".repeat(64)), body),
                CallbackEndpoint.REFUSED);
        unchanged(Desk.post(repository, Map.of("x-standin-signature", header.substring(0, header.length() - 1)),
                body), CallbackEndpoint.REFUSED);
        // The right signature in capitals: not the scheme's form.
        unchanged(Desk.post(repository, Map.of("x-standin-signature", header.toUpperCase().replace("T=", "t=")
                .replace("V1=", "v1=")), body), CallbackEndpoint.REFUSED);
        // Not refused for good: the genuine one is taken afterwards.
        assertEquals(CallbackEndpoint.RECEIVED, signed("evt_1"));
    }

    @Test
    public void aStaleOrFutureCallbackIsRefused() {
        byte[] body = StandInStub.callbackBody("evt_1", "envelope.signed", envelope, null);
        long now = Clock.systemUTC().instant().getEpochSecond();
        unchanged(Desk.post(repository, StandInStub.signedHeaders(StandInStub.SECRET, now - 301, body), body),
                CallbackEndpoint.REFUSED);
        unchanged(Desk.post(repository, StandInStub.signedHeaders(StandInStub.SECRET, now + 301, body), body),
                CallbackEndpoint.REFUSED);
        assertEquals(CallbackEndpoint.RECEIVED,
                Desk.post(repository, StandInStub.signedHeaders(StandInStub.SECRET, now - 200, body), body));
    }

    @Test
    public void anAuthenticatedCallbackThatIsNotOneIsRefused() {
        byte[] body = "{\"id\":\"evt_1\",\"envelope\":\"../etc\",\"type\":\"envelope.signed\"}"
                .getBytes(StandardCharsets.UTF_8);
        long now = Clock.systemUTC().instant().getEpochSecond();
        unchanged(Desk.post(repository, StandInStub.signedHeaders(StandInStub.SECRET, now, body), body),
                CallbackEndpoint.MALFORMED);
        byte[] notJson = "signed".getBytes(StandardCharsets.UTF_8);
        unchanged(Desk.post(repository, StandInStub.signedHeaders(StandInStub.SECRET, now, notJson), notJson),
                CallbackEndpoint.REFUSED);
    }

    // ------------------------------------------------------------------ once, and the right request

    @Test
    public void aReplayedCallbackIsRefused() {
        byte[] body = StandInStub.callbackBody("evt_1", "envelope.signed", envelope, null);
        Map<String, String> headers = StandInStub.signedHeaders(StandInStub.SECRET,
                Clock.systemUTC().instant().getEpochSecond(), body);
        assertEquals(CallbackEndpoint.RECEIVED, Desk.post(repository, headers, body));
        stub.requests.clear();
        assertEquals(CallbackEndpoint.ALREADY, Desk.post(repository, headers, body));
        assertEquals(List.of(), stub.requests);
        assertEquals(1, Desk.versions(repository, caseId).size());
        // A new callback for the same envelope, once it has ended: refused too.
        assertEquals(CallbackEndpoint.ENDED,
                Desk.callback(repository, "evt_2", "envelope.declined", envelope, null));
        assertEquals(Signatures.SIGNED, text(Desk.stored(repository, requestId), Signatures.STATUS));
    }

    @Test
    public void aCallbackForAnUnknownEnvelopeIsRefused() {
        unchanged(Desk.callback(repository, "evt_1", "envelope.signed", "env_404", null), CallbackEndpoint.NOT_FOUND);
        // Its id is not kept: a retry, once the envelope is known, is not taken for a replay.
        assertEquals(CallbackEndpoint.NOT_FOUND,
                Desk.callback(repository, "evt_1", "envelope.signed", "env_404", null));
    }

    @Test
    public void whenTheServiceDoesNotSaySignedNothingIsFiledAndTheRetryIsTaken() {
        stub.mode = StandInStub.Mode.NOT_SIGNED;
        unchanged(signed("evt_1"), CallbackEndpoint.PROVIDER_FAILED);
        stub.mode = StandInStub.Mode.TAMPERED;
        unchanged(signed("evt_1"), CallbackEndpoint.PROVIDER_FAILED);
        stub.mode = StandInStub.Mode.NORMAL;
        assertEquals(CallbackEndpoint.RECEIVED, signed("evt_1"));
        assertEquals(1, Desk.versions(repository, caseId).size());
    }

    @Test
    public void onlyAPostToARegisteredConfiguredProviderIsRead() {
        byte[] body = StandInStub.callbackBody("evt_1", "envelope.signed", envelope, null);
        Map<String, String> headers = StandInStub.signedHeaders(StandInStub.SECRET,
                Clock.systemUTC().instant().getEpochSecond(), body);
        unchanged(Desk.answer(repository, "GET", "/callback/standin", headers, body), CallbackEndpoint.NOT_ALLOWED);
        unchanged(Desk.answer(repository, "POST", "/callback/other", headers, body), CallbackEndpoint.NOT_FOUND);
        unchanged(Desk.answer(repository, "POST", "/callback/StandIn", headers, body), CallbackEndpoint.NOT_FOUND);
        unchanged(Desk.answer(repository, "POST", "/callback/standin/../x", headers, body), CallbackEndpoint.NOT_FOUND);
        unchanged(Desk.answer(repository, "POST", "/standin", headers, body), CallbackEndpoint.NOT_FOUND);
        Map<String, String> properties = Desk.configure(stub);
        properties.remove("nuxeo.agentic.signature.standin.callbackSecret");
        Desk.use(properties);
        unchanged(Desk.post(repository, headers, body), CallbackEndpoint.UNAVAILABLE);
    }

    /** The answer, and the request, the record and the service as they were. */
    private void unchanged(CallbackEndpoint.Response answer, CallbackEndpoint.Response expected) {
        assertEquals(expected, answer);
        assertEquals(Signatures.SENT, text(Desk.stored(repository, requestId), Signatures.STATUS));
        DocumentModel record = Desk.stored(repository, caseId);
        assertEquals(Signatures.SENT, text(record, Signatures.SGN_STATUS));
        assertArrayEquals(PDF, Desk.bytes((Blob) record.getPropertyValue("files:files/1/file")));
        assertEquals(List.of(), Desk.versions(repository, caseId));
    }
}
