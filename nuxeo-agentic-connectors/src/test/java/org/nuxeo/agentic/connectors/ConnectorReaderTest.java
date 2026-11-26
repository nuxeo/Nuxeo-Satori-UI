package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.connectors.ConnectorException.Kind;
import org.nuxeo.agentic.connectors.SystemOfRecordStub.Answer;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.IdRef;

/**
 * The order {@link ConnectorService#read} keeps: the reader's {@code Read}, the connector, its own
 * permission, the stored document, its type, its key, and only then the call. Each refusal is
 * checked against the stub, which must have received nothing.
 */
class ConnectorReaderTest {

    private static final String REF = "4c6e9f1a-claim";

    private SystemOfRecordStub stub;

    private SystemOfRecordClient client;

    private final Map<String, Connector> connectors = new HashMap<>();

    private ConnectorReader reader;

    @BeforeEach
    void start() throws Exception {
        stub = new SystemOfRecordStub();
        stub.answer("/claims/CLAIM-000130", Answer.json("{ \"paymentStatus\": \"Paid\", \"secret\": \"x\" }"));
        stub.answer("/claims/CLAIM-999999", Answer.json("{ \"paymentStatus\": \"Someone else's\" }"));
        stub.answer("/claims/42", Answer.json("{ \"paymentStatus\": \"Pending\" }"));
        settings = new Fixtures.Settings().allowHttp().address(stub.address());
        client = new SystemOfRecordClient(settings.settings());
        Connector connector = Connector.of(Fixtures.descriptor());
        connectors.put(connector.id(), connector);
        cache = new ConnectorCache(settings.settings(), clock);
        reader = new ConnectorReader(connectors::get, client, cache, Fixtures.metrics());
    }

    private Fixtures.Settings settings;

    private final Fixtures.Clock clock = new Fixtures.Clock();

    private ConnectorCache cache;

    @AfterEach
    void stop() {
        client.close();
        stub.close();
    }

    private ConnectorAnswer read(Fixtures.Session session, DocumentModel given) {
        return reader.read(session.session(), given, "test.claimPayments", false);
    }

    @Test
    void aReaderOfTheDocumentGetsTheAllowedFields() {
        Fixtures.Session session = new Fixtures.Session("Read");

        ConnectorAnswer answer = read(session, Fixtures.claim("CLAIM-000130", true));

        assertEquals(ConnectorAnswer.Status.FOUND, answer.status());
        assertEquals(List.of("paymentStatus"), List.copyOf(answer.fields().keySet()));
        assertEquals(List.of(REF + " Read", "getDocument " + REF), session.asked);
        assertEquals(1, stub.received.size());
    }

    @Test
    void theKeyIsTheStoredDocumentsNeverTheOneTheRequestGave() {
        // Automation applies a JSON entity's properties to the input document in memory: a reader
        // who may only read this claim sends it with another claim's number.
        Fixtures.Session session = new Fixtures.Session("Read").storing(Fixtures.claim("CLAIM-000130", true));

        ConnectorAnswer answer = read(session, Fixtures.claim("CLAIM-999999", true));

        assertEquals("Paid", answer.fields().get("paymentStatus").asText());
        assertEquals(List.of("/claims/CLAIM-000130"), stub.received.stream().map(r -> r.path()).toList());
    }

    @Test
    void withoutReadNothingIsSentAndNoConnectorIsNamed() {
        Fixtures.Session session = new Fixtures.Session();

        assertThrows(DocumentSecurityException.class, () -> read(session, Fixtures.claim("CLAIM-000130", true)));
        // The same refusal for a connector that does not exist: no one learns which do.
        assertThrows(DocumentSecurityException.class,
                () -> reader.read(session.session(), Fixtures.claim("CLAIM-000130", true), "other", false));
        assertEquals(List.of(REF + " Read", REF + " Read"), session.asked);
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void aDocumentWithNoReferenceIsRefusedUnasked() {
        Fixtures.Session session = new Fixtures.Session("Read");
        assertThrows(DocumentSecurityException.class,
                () -> read(session, Fixtures.document("Claim", "CLAIM-000130", true, null)));
        assertThrows(DocumentSecurityException.class, () -> read(session, null));
        assertTrue(session.asked.isEmpty());
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void theConnectorsOwnPermissionIsAskedAfterRead() {
        ConnectorDescriptor d = Fixtures.descriptor();
        d.permission = "ReadWrite";
        Connector strict = Connector.of(d);
        connectors.put(strict.id(), strict);
        Fixtures.Session reads = new Fixtures.Session("Read");

        assertThrows(DocumentSecurityException.class, () -> read(reads, Fixtures.claim("CLAIM-000130", true)));
        assertEquals(List.of(REF + " Read", REF + " ReadWrite"), reads.asked);
        assertTrue(stub.received.isEmpty());

        assertEquals(ConnectorAnswer.Status.FOUND,
                read(new Fixtures.Session("Read", "ReadWrite"), Fixtures.claim("CLAIM-000130", true)).status());
    }

    @Test
    void anUnknownConnectorIsRefusedBeforeAnythingIsSent() {
        Fixtures.Session session = new Fixtures.Session("Read");
        for (String id : new String[] { "other", "../test.claimPayments", "https://core.example.invalid", "", null }) {
            ConnectorException refused = assertThrows(ConnectorException.class,
                    () -> reader.read(session.session(), Fixtures.claim("CLAIM-000130", true), id, false));
            assertEquals(Kind.UNKNOWN_CONNECTOR, refused.getKind());
            assertEquals(404, refused.getStatusCode());
        }
        assertTrue(session.asked.stream().noneMatch(asked -> asked.startsWith("getDocument")));
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void aDocumentOfATypeTheConnectorDoesNotReadAnswersNoKey() {
        Fixtures.Session session = new Fixtures.Session("Read")
                                                              .storing(Fixtures.document("Note", "CLAIM-000130", true,
                                                                      new IdRef(REF)));
        assertEquals(ConnectorAnswer.Status.NO_KEY, read(session, Fixtures.claim("CLAIM-000130", true)).status());
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void aDocumentWithNoKeyItCanSendAnswersNoKeyAndSendsNothing() {
        List<DocumentModel> documents = new ArrayList<>();
        documents.add(Fixtures.claim(null, true));
        documents.add(Fixtures.claim("", true));
        documents.add(Fixtures.claim("   ", true));
        documents.add(Fixtures.claim("../admin", true));
        documents.add(Fixtures.claim("CLAIM-1?all=true", true));
        documents.add(Fixtures.claim(new String[] { "CLAIM-000130" }, true));
        documents.add(Fixtures.claim((Serializable) Map.of("number", "CLAIM-000130"), true));
        documents.add(Fixtures.claim("CLAIM-000130", false));
        for (DocumentModel stored : documents) {
            Fixtures.Session session = new Fixtures.Session("Read").storing(stored);
            assertEquals(ConnectorAnswer.Status.NO_KEY, read(session, Fixtures.claim("CLAIM-000130", true)).status());
        }
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void aKeyThatIsAWholeNumberIsSentAsItsDigits() {
        Fixtures.Session session = new Fixtures.Session("Read").storing(Fixtures.claim(42L, true));
        assertEquals("Pending", read(session, Fixtures.claim(42L, true)).fields().get("paymentStatus").asText());
        assertEquals("/claims/42", stub.received.get(0).path());
    }

    @Test
    void aKeyIsTrimmedBeforeItIsSent() {
        Fixtures.Session session = new Fixtures.Session("Read").storing(Fixtures.claim("  CLAIM-000130 ", true));
        read(session, Fixtures.claim("CLAIM-000130", true));
        assertEquals("/claims/CLAIM-000130", stub.received.get(0).path());
    }

    @Test
    void aFreshAnswerIsZeroSecondsOldAndNoKeyHasNoAge() {
        assertEquals(0L, read(new Fixtures.Session("Read"), Fixtures.claim("CLAIM-000130", true)).age());
        Fixtures.Session none = new Fixtures.Session("Read").storing(Fixtures.claim(null, true));
        assertEquals(null, read(none, Fixtures.claim("CLAIM-000130", true)).age());
        assertTrue(!read(none, Fixtures.claim("CLAIM-000130", true)).toJson().contains("\"age\""));
    }

    /**
     * Every check runs again before a kept answer is given: the cache is asked last, so a reader
     * without {@code Read}, or without the connector's own permission, never has one.
     */
    @Test
    void aKeptAnswerIsGivenOnlyAfterEveryCheck() {
        settings.ttl("60");
        Fixtures.Session reads = new Fixtures.Session("Read");
        assertEquals(0L, read(reads, Fixtures.claim("CLAIM-000130", true)).age());
        clock.advance(java.time.Duration.ofSeconds(7));
        Fixtures.Session again = new Fixtures.Session("Read");
        assertEquals(7L, read(again, Fixtures.claim("CLAIM-000130", true)).age());
        assertEquals(List.of(REF + " Read", "getDocument " + REF), again.asked);
        assertEquals(1, stub.received.size());

        assertThrows(DocumentSecurityException.class,
                () -> read(new Fixtures.Session(), Fixtures.claim("CLAIM-000130", true)));

        ConnectorDescriptor d = Fixtures.descriptor();
        d.permission = "ReadWrite";
        Connector strict = Connector.of(d);
        connectors.put(strict.id(), strict);
        assertThrows(DocumentSecurityException.class,
                () -> read(new Fixtures.Session("Read"), Fixtures.claim("CLAIM-000130", true)));
        assertEquals(1, stub.received.size());
    }

    /**
     * A change event that comes while a call is on its way: the system may have answered before its
     * record changed, so that answer is given to its reader and not kept, and the next read asks
     * again.
     */
    @Test
    void anEventWhileACallIsOnItsWayKeepsItsAnswerOut() throws Exception {
        settings.ttl("60");
        stub.answer("/claims/CLAIM-000130",
                Answer.json("{ \"paymentStatus\": \"Paid before the change\" }").delay(400));
        java.util.concurrent.CompletableFuture<ConnectorAnswer> first = java.util.concurrent.CompletableFuture.supplyAsync(
                () -> read(new Fixtures.Session("Read"), Fixtures.claim("CLAIM-000130", true)));
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
        while (stub.received.isEmpty() && System.nanoTime() < deadline) {
            Thread.onSpinWait();
        }
        assertEquals(1, stub.received.size(), "the call is on its way");
        clock.advance(java.time.Duration.ofMillis(100));
        cache.invalidate(connectors.get("test.claimPayments"), "CLAIM-000130");
        assertEquals("Paid before the change", first.get().fields().get("paymentStatus").asText());
        assertEquals(0, cache.size("test.claimPayments"));

        clock.advance(java.time.Duration.ofSeconds(1));
        read(new Fixtures.Session("Read"), Fixtures.claim("CLAIM-000130", true));
        assertEquals(2, stub.received.size(), "asked again");
    }

    /**
     * A connector that asks for more than {@code Read}: its answer, kept for a reader who holds that,
     * is refused to one who holds only {@code Read}, and the cache is not reached.
     */
    @Test
    void aKeptAnswerOfAStricterConnectorIsRefusedToAReaderWithReadOnly() {
        settings.ttl("60");
        ConnectorDescriptor d = Fixtures.descriptor();
        d.permission = "ReadWrite";
        Connector strict = Connector.of(d);
        connectors.put(strict.id(), strict);
        read(new Fixtures.Session("Read", "ReadWrite"), Fixtures.claim("CLAIM-000130", true));
        assertEquals(1, cache.size(strict.id()));
        assertEquals(1, stub.received.size());

        Fixtures.Session readOnly = new Fixtures.Session("Read");
        assertThrows(DocumentSecurityException.class, () -> read(readOnly, Fixtures.claim("CLAIM-000130", true)));
        assertEquals(List.of(REF + " Read", REF + " ReadWrite"), readOnly.asked);
        assertEquals(1, stub.received.size());

        // The one who may is given it, from the cache.
        clock.advance(java.time.Duration.ofSeconds(2));
        assertEquals(2L, read(new Fixtures.Session("Read", "ReadWrite"), Fixtures.claim("CLAIM-000130", true)).age());
        assertEquals(1, stub.received.size());
    }

    @Test
    void aReadPastTheCacheIsAnAdministratorsOnly() {
        settings.ttl("60");
        read(new Fixtures.Session("Read"), Fixtures.claim("CLAIM-000130", true));
        clock.advance(java.time.Duration.ofSeconds(5));

        Fixtures.Session reader = new Fixtures.Session("Read");
        ConnectorException refused = assertThrows(ConnectorException.class,
                () -> this.reader.read(reader.session(), Fixtures.claim("CLAIM-000130", true), "test.claimPayments",
                        true));
        assertEquals(Kind.REFRESH_NOT_ALLOWED, refused.getKind());
        assertEquals(403, refused.getStatusCode());
        // Refused before the document is read, and before anything is sent.
        assertTrue(reader.asked.stream().noneMatch(asked -> asked.startsWith("getDocument")));
        assertEquals(1, stub.received.size());

        Fixtures.Session administrator = new Fixtures.Session("Read").administrator();
        ConnectorAnswer fresh = this.reader.read(administrator.session(), Fixtures.claim("CLAIM-000130", true),
                "test.claimPayments", true);
        assertEquals(0L, fresh.age());
        assertEquals(2, stub.received.size());
        // The fresh answer is the one kept now.
        assertEquals(0L, read(new Fixtures.Session("Read"), Fixtures.claim("CLAIM-000130", true)).age());
        assertEquals(2, stub.received.size());
    }
}
