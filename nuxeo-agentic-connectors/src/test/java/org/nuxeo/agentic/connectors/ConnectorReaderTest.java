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

/**
 * The order {@link ConnectorService#read} keeps: the connector, the reader's permission on the
 * document, the key, and only then the call. Each refusal is checked against the stub, which must
 * have received nothing.
 */
class ConnectorReaderTest {

    private SystemOfRecordStub stub;

    private SystemOfRecordClient client;

    private final Map<String, Connector> connectors = new HashMap<>();

    private ConnectorReader reader;

    @BeforeEach
    void start() throws Exception {
        stub = new SystemOfRecordStub();
        stub.answer("/claims/CLAIM-000130", Answer.json("{ \"paymentStatus\": \"Paid\", \"secret\": \"x\" }"));
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

    @Test
    void aReaderOfTheDocumentGetsTheAllowedFields() {
        Fixtures.Session session = new Fixtures.Session("Read");

        ConnectorAnswer answer = reader.read(session.session(), Fixtures.claim("CLAIM-000130", true),
                "test.claimPayments");

        assertEquals(ConnectorAnswer.Status.FOUND, answer.status());
        assertEquals(List.of("paymentStatus"), List.copyOf(answer.fields().keySet()));
        assertEquals(List.of("4c6e9f1a-claim Read"), session.asked);
        assertEquals(1, stub.received.size());
    }

    @Test
    void withoutThePermissionNothingIsSent() {
        Fixtures.Session session = new Fixtures.Session();

        assertThrows(DocumentSecurityException.class,
                () -> reader.read(session.session(), Fixtures.claim("CLAIM-000130", true), "test.claimPayments"));
        assertEquals(List.of("4c6e9f1a-claim Read"), session.asked);
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void theConnectorsOwnPermissionIsTheOneAsked() {
        ConnectorDescriptor d = Fixtures.descriptor();
        d.permission = "ReadWrite";
        Connector strict = Connector.of(d);
        connectors.put(strict.id(), strict);
        Fixtures.Session reads = new Fixtures.Session("Read");

        assertThrows(DocumentSecurityException.class,
                () -> reader.read(reads.session(), Fixtures.claim("CLAIM-000130", true), strict.id()));
        assertEquals(List.of("4c6e9f1a-claim ReadWrite"), reads.asked);
        assertTrue(stub.received.isEmpty());

        assertEquals(ConnectorAnswer.Status.FOUND,
                reader.read(new Fixtures.Session("ReadWrite").session(), Fixtures.claim("CLAIM-000130", true),
                        strict.id()).status());
    }

    @Test
    void anUnknownConnectorIsRefusedBeforeAnythingElse() {
        Fixtures.Session session = new Fixtures.Session("Read");
        for (String id : new String[] { "other", "../test.claimPayments", "https://core.example.invalid", "", null }) {
            ConnectorException refused = assertThrows(ConnectorException.class,
                    () -> reader.read(session.session(), Fixtures.claim("CLAIM-000130", true), id));
            assertEquals(Kind.UNKNOWN_CONNECTOR, refused.getKind());
            assertEquals(404, refused.getStatusCode());
        }
        assertTrue(session.asked.isEmpty());
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void aDocumentWithNoKeyItCanSendAnswersNoKeyAndSendsNothing() {
        Fixtures.Session session = new Fixtures.Session("Read");
        List<DocumentModel> documents = new ArrayList<>();
        documents.add(Fixtures.claim(null, true));
        documents.add(Fixtures.claim("", true));
        documents.add(Fixtures.claim("   ", true));
        documents.add(Fixtures.claim("../admin", true));
        documents.add(Fixtures.claim("CLAIM-1?all=true", true));
        documents.add(Fixtures.claim(new String[] { "CLAIM-000130" }, true));
        documents.add(Fixtures.claim((Serializable) Map.of("number", "CLAIM-000130"), true));
        documents.add(Fixtures.claim("CLAIM-000130", false));
        for (DocumentModel document : documents) {
            assertEquals(ConnectorAnswer.Status.NO_KEY,
                    reader.read(session.session(), document, "test.claimPayments").status());
        }
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void aKeyThatIsAWholeNumberIsSentAsItsDigits() {
        assertEquals("Pending", reader.read(new Fixtures.Session("Read").session(), Fixtures.claim(42L, true),
                "test.claimPayments").fields().get("paymentStatus").asText());
        assertEquals("/claims/42", stub.received.get(0).path());
    }

    @Test
    void aKeyIsTrimmedBeforeItIsSent() {
        reader.read(new Fixtures.Session("Read").session(), Fixtures.claim("  CLAIM-000130 ", true),
                "test.claimPayments");
        assertEquals("/claims/CLAIM-000130", stub.received.get(0).path());
    }
}
