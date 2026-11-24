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
        client = new SystemOfRecordClient(new Fixtures.Settings().allowHttp().address(stub.address()).settings());
        Connector connector = Connector.of(Fixtures.descriptor());
        connectors.put(connector.id(), connector);
        reader = new ConnectorReader(connectors::get, client);
    }

    @AfterEach
    void stop() {
        client.close();
        stub.close();
    }

    private ConnectorAnswer read(Fixtures.Session session, DocumentModel given) {
        return reader.read(session.session(), given, "test.claimPayments");
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
                () -> reader.read(session.session(), Fixtures.claim("CLAIM-000130", true), "other"));
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
                    () -> reader.read(session.session(), Fixtures.claim("CLAIM-000130", true), id));
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
}
