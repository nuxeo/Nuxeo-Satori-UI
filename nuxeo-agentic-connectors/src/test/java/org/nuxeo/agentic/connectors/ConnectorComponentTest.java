package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.connectors.ConnectorException.Kind;
import org.nuxeo.agentic.connectors.SystemOfRecordStub.Answer;

import com.fasterxml.jackson.databind.JsonNode;

/** How contributions become connectors, and the operation's answer through the component. */
class ConnectorComponentTest {

    @Test
    void aLaterContributionReplacesAnInvalidOneIsLeftOutAndDisabledRemoves() {
        ConnectorComponent component = new ConnectorComponent();
        component.register(Fixtures.descriptor(), "kit");
        assertEquals("/claims/{key}", component.getConnector("test.claimPayments").path());

        ConnectorDescriptor replacement = Fixtures.descriptor();
        replacement.path = "/v2/claims/{key}";
        component.register(replacement, "later-kit");
        assertEquals("/v2/claims/{key}", component.getConnector("test.claimPayments").path());

        ConnectorDescriptor broken = Fixtures.descriptor();
        broken.path = "/claims";
        component.register(broken, "broken-kit");
        assertEquals("/v2/claims/{key}", component.getConnector("test.claimPayments").path(),
                "an invalid replacement must leave the connector in force");

        // Unregistering a contribution that is not the one in force changes nothing.
        component.unregister(Fixtures.descriptor());
        assertNotNull(component.getConnector("test.claimPayments"));

        ConnectorDescriptor disabled = new ConnectorDescriptor();
        disabled.id = "test.claimPayments";
        disabled.enabled = false;
        component.register(disabled, "customer");
        assertNull(component.getConnector("test.claimPayments"));
        assertNull(component.getConnector(null));
    }

    @Test
    void theOperationAnswersTheConnectorsJson() throws Exception {
        try (SystemOfRecordStub stub = new SystemOfRecordStub()) {
            stub.answer("/claims/CLAIM-000130", Answer.json("{ \"paymentStatus\": \"Paid\", \"other\": 1 }"));
            ConnectorComponent component = new ConnectorComponent();
            component.register(Fixtures.descriptor(), "kit");
            component.start(new Fixtures.Settings().allowHttp().address(stub.address()).settings());
            try {
                ReadConnectorOperation operation = new ReadConnectorOperation();
                operation.session = new Fixtures.Session("Read").session();
                operation.connectors = component;
                operation.connector = "test.claimPayments";

                org.nuxeo.ecm.core.api.Blob blob = operation.run(Fixtures.claim("CLAIM-000130", true));

                assertEquals("application/json", blob.getMimeType());
                JsonNode json = ConnectorAnswer.JSON.readTree(blob.getString());
                assertEquals(ConnectorAnswer.JSON.readTree("""
                        { "connector": "test.claimPayments", "status": "found", "fields": { "paymentStatus": "Paid" } }
                        """), json);
            } finally {
                component.stop(null);
            }
        }
    }

    @Test
    void twoIdsThatShareAnEnvironmentPrefixAreNotBothRegistered() {
        ConnectorComponent component = new ConnectorComponent();
        component.register(Fixtures.descriptor(), "kit");
        ConnectorDescriptor clash = Fixtures.descriptor();
        clash.id = "test_claimPayments";
        clash.addressProperty = "nuxeo.agentic.connectors.test_claimPayments.address";
        component.register(clash, "other-kit");
        assertNotNull(component.getConnector("test.claimPayments"));
        assertNull(component.getConnector("test_claimPayments"));
    }

    @Test
    void beforeItStartsNothingIsRead() {
        ConnectorComponent component = new ConnectorComponent();
        component.register(Fixtures.descriptor(), "kit");
        ConnectorException refused = assertThrows(ConnectorException.class,
                () -> component.read(new Fixtures.Session("Read").session(), Fixtures.claim("C1", true),
                        "test.claimPayments"));
        assertEquals(Kind.NOT_CONFIGURED, refused.getKind());
    }
}
