package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.IntStream;

import org.junit.jupiter.api.Test;

/** What a contribution must say before its connector is registered, one element at a time. */
class ConnectorTest {

    private static String refusal(Consumer<ConnectorDescriptor> change) {
        ConnectorDescriptor d = Fixtures.descriptor();
        change.accept(d);
        return assertThrows(IllegalArgumentException.class, () -> Connector.of(d)).getMessage();
    }

    @Test
    void aSoundDescriptorTakesTheDefaults() {
        Connector connector = Connector.of(Fixtures.descriptor());

        assertEquals("test.claimPayments", connector.id());
        assertEquals("Read", connector.permission());
        assertEquals(Duration.ofMillis(2_000), connector.connectTimeout());
        assertEquals(Duration.ofMillis(5_000), connector.timeout());
        assertEquals(256 * 1024, connector.maxBytes());
        assertNull(connector.credential());
        assertEquals("/paymentStatus", connector.fields().get(0).pointer().toString());
        assertEquals("/payment/amount", connector.fields().get(1).pointer().toString());
    }

    @Test
    void theIdIsANameNeverAnAddress() {
        for (String id : List.of("", "https://core.example.invalid", "a/b", "1abc", "a b", "x".repeat(65))) {
            assertTrue(refusal(d -> d.id = id).contains("its id"), id);
        }
        assertTrue(refusal(d -> d.id = null).contains("with no id"));
    }

    @Test
    void theAddressIsAServerPropertysNameNeverAnAddress() {
        assertTrue(refusal(d -> d.addressProperty = null).contains("<address property"));
        assertTrue(refusal(d -> d.addressProperty = "https://core.example.invalid").contains("<address property"));
    }

    @Test
    void thePathHoldsTheKeyOnceAndNoQueryOrClimb() {
        for (String path : List.of("claims/{key}", "/claims", "/claims/{key}/{key}", "/claims/{key}?x=1",
                "/claims/{key}#f", "/../{key}", "/./{key}", "//{key}", "/claims//{key}", "/claims/{key}/",
                "/c%2F/{key}", "/claims/{id}", "/claims/{key}{x}", "/" + "x".repeat(256) + "/{key}")) {
            assertFalse(Connector.soundPath(path), path);
            assertTrue(refusal(d -> d.path = path).contains("<path>"), path);
        }
        for (String path : List.of("/claims/{key}", "/v2/members/{key}/policy", "/{key}", "/a.b_c~d-e/{key}.json")) {
            assertTrue(Connector.soundPath(path), path);
        }
    }

    @Test
    void theKeyIsADocumentProperty() {
        for (String xpath : List.of("number", "claim:", ":number", "claim:number/x", "claim:num ber")) {
            assertTrue(refusal(d -> d.keyXpath = xpath).contains("<key xpath"), xpath);
        }
    }

    @Test
    void thePermissionIsAName() {
        assertTrue(refusal(d -> d.permission = "Read Write").contains("<permission>"));
        ConnectorDescriptor d = Fixtures.descriptor();
        d.permission = "ReadWrite";
        assertEquals("ReadWrite", Connector.of(d).permission());
    }

    @Test
    void aCredentialNamesWhereItsValueIsNeverTheValue() {
        ConnectorDescriptor sound = Fixtures.withCredential(Fixtures.descriptor());
        Connector.Credential credential = Connector.of(sound).credential();
        assertEquals("Authorization", credential.header());
        assertEquals("Bearer ", credential.prefix());
        assertEquals(Fixtures.TOKEN_PROPERTY, credential.property());
        assertEquals(Fixtures.TOKEN_ENV, credential.env());

        assertTrue(refusal(d -> {
            Fixtures.withCredential(d);
            d.credentialProperty = null;
            d.credentialEnv = null;
        }).contains("must name a server property or an environment variable"));
        assertTrue(refusal(d -> d.credentialProperty = "x").contains("needs the header"));
        for (String header : List.of("Host", "Content-Length", "Proxy-Authorization", "Cookie", "Connection",
                "Authorization: x", "X Api Key")) {
            assertTrue(refusal(d -> {
                Fixtures.withCredential(d);
                d.credentialHeader = header;
            }).contains("<credential header>"), header);
        }
        assertTrue(refusal(d -> {
            Fixtures.withCredential(d);
            d.credentialPrefix = "Bearer\r\nX-Injected: ";
        }).contains("<credential prefix>"));
        assertTrue(refusal(d -> {
            Fixtures.withCredential(d);
            d.credentialEnv = "lower_case";
        }).contains("<credential env>"));
    }

    @Test
    void eachBoundHasARange() {
        assertTrue(refusal(d -> d.connectTimeout = 99).contains("<connectTimeout>"));
        assertTrue(refusal(d -> d.connectTimeout = 10_001).contains("<connectTimeout>"));
        assertTrue(refusal(d -> d.timeout = 30_001).contains("<timeout>"));
        assertTrue(refusal(d -> d.timeout = 0).contains("<timeout>"));
        assertTrue(refusal(d -> d.maxBytes = 1023).contains("<maxBytes>"));
        assertTrue(refusal(d -> d.maxBytes = 1024 * 1024 + 1).contains("<maxBytes>"));
    }

    @Test
    void theAllowListHasOneToFiftyNamedFields() {
        assertTrue(refusal(d -> d.fields = new ArrayList<>()).contains("at least one <field>"));
        assertTrue(refusal(d -> d.fields = new ArrayList<>(IntStream.range(0, 51)
                                                                      .mapToObj(i -> Fixtures.field("f" + i, null))
                                                                      .toList())).contains("at most 50"));
        assertTrue(refusal(d -> d.fields.add(Fixtures.field("paid", null))).contains("named twice"));
        for (String name : List.of("claim:number", "paid-amount", "1st", "", "a b")) {
            assertTrue(refusal(d -> d.fields.add(Fixtures.field(name, null))).contains("<field name>"), name);
        }
        for (String pointer : List.of("payment/amount", "/" + "x".repeat(256))) {
            assertTrue(refusal(d -> d.fields.add(Fixtures.field("other", pointer))).contains("pointer"), pointer);
        }
    }

    @Test
    void everyProblemIsNamedAtOnce() {
        String message = refusal(d -> {
            d.path = "/claims";
            d.keyXpath = "number";
            d.timeout = 0;
        });
        assertTrue(message.contains("<path>"));
        assertTrue(message.contains("<key xpath"));
        assertTrue(message.contains("<timeout>"));
    }
}
