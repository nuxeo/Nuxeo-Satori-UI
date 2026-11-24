package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.connectors.ConnectorException.Kind;
import org.nuxeo.agentic.connectors.SystemOfRecordStub.Answer;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * What a call to a system of record sends and accepts, against a stub on the loopback interface:
 * where it goes, what it carries, the allow-list, and each bound. Every refusal also checks what the
 * stub received, so that "refused" means "refused before or instead of sending", not only "threw".
 */
class SystemOfRecordClientTest {

    private static final String RECORD = """
            { "paymentStatus": "Paid",
              "payment": { "amount": 412.5, "paid": true, "bankAccount": "FICTIONAL-0000" },
              "internalNotes": "not on the allow-list",
              "memberSsn": "987-65-4321" }
            """;

    private SystemOfRecordStub stub;

    private Fixtures.Settings settings;

    private SystemOfRecordClient client;

    @BeforeEach
    void start() throws Exception {
        stub = new SystemOfRecordStub();
        settings = new Fixtures.Settings().allowHttp().address(stub.address() + "/core");
        client = new SystemOfRecordClient(settings.settings());
    }

    @AfterEach
    void stop() {
        client.close();
        stub.close();
    }

    private static Connector connector() {
        return Connector.of(Fixtures.descriptor());
    }

    private static Connector connector(java.util.function.Consumer<ConnectorDescriptor> change) {
        ConnectorDescriptor d = Fixtures.descriptor();
        change.accept(d);
        return Connector.of(d);
    }

    private ConnectorException refused(Connector connector, String key) {
        return assertThrows(ConnectorException.class, () -> client.fetch(connector, key));
    }

    @Test
    void returnsOnlyTheAllowedFieldsOfTheRecord() {
        stub.answer("/core/claims/CLAIM-000130", Answer.json(RECORD));

        ConnectorAnswer answer = client.fetch(connector(), "CLAIM-000130");

        assertEquals(ConnectorAnswer.Status.FOUND, answer.status());
        assertEquals(List.of("paymentStatus", "paidAmount", "paid"), List.copyOf(answer.fields().keySet()));
        assertEquals("Paid", answer.fields().get("paymentStatus").asText());
        assertEquals(412.5, answer.fields().get("paidAmount").asDouble());
        assertTrue(answer.fields().get("paid").asBoolean());
        String json = answer.toJson();
        for (String withheld : List.of("bankAccount", "FICTIONAL-0000", "internalNotes", "memberSsn", "987-65-4321")) {
            assertFalse(json.contains(withheld), withheld + " left the server: " + json);
        }
    }

    @Test
    void aPointerToABranchOrANullReturnsNothingForThatField() {
        stub.answer("/core/claims/C1",
                Answer.json("{ \"paymentStatus\": null, \"payment\": { \"amount\": [1, 2], \"paid\": { \"x\": 1 } } }"));

        ConnectorAnswer answer = client.fetch(connector(), "C1");

        assertEquals(ConnectorAnswer.Status.FOUND, answer.status());
        assertTrue(answer.fields().isEmpty(), answer.fields().toString());
    }

    @Test
    void sendsOneGetToTheServersAddressWithTheKeyAsOnePathSegment() {
        stub.answer("/core/claims/CLAIM-000130", Answer.json(RECORD));

        client.fetch(connector(), "CLAIM-000130");

        assertEquals(1, stub.received.size());
        SystemOfRecordStub.Received request = stub.received.get(0);
        assertEquals("GET", request.method());
        assertEquals("/core/claims/CLAIM-000130", request.path());
        assertNull(request.rawQuery());
        assertEquals("application/json", request.header("Accept"));
        assertNull(request.header("Authorization"), "a connector with no credential sends none");
        assertNull(request.header("Cookie"));
    }

    @Test
    void aKeyThatIsNotOnePathSegmentIsNeverSent() {
        for (String key : List.of("../admin", "..", ".", ".hidden", "a/b", "a?b=1", "a#b", "%2e%2e", "a b", "a\\b",
                "a;b", "a:b", "a@b", "é", "", " ", "x".repeat(129))) {
            assertFalse(SystemOfRecordClient.sendable(key), key);
            assertThrows(IllegalArgumentException.class, () -> client.target(connector(), key), key);
        }
        for (String key : List.of("CLAIM-000130", "M.1001", "a_b", "7", "x".repeat(128))) {
            assertTrue(SystemOfRecordClient.sendable(key), key);
        }
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void theAddressIsTheServerPropertyJoinedWithTheConnectorsPath() {
        assertEquals(stub.address() + "/core/claims/K1", client.target(connector(), "K1").toString());
        settings.address(stub.address() + "/core/");
        assertEquals(stub.address() + "/core/claims/K1", client.target(connector(), "K1").toString());
        settings.address(stub.address());
        assertEquals(stub.address() + "/claims/K1", client.target(connector(), "K1").toString());
    }

    @Test
    void withNoAddressOnTheServerNothingIsSent() {
        settings.properties.remove(Fixtures.ADDRESS_PROPERTY);
        assertEquals(Kind.NOT_CONFIGURED, refused(connector(), "K1").getKind());
        settings.properties.put(Fixtures.ADDRESS_PROPERTY, "   ");
        assertEquals(Kind.NOT_CONFIGURED, refused(connector(), "K1").getKind());
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void plainHttpIsRefusedUnlessTheServerAllowsIt() {
        settings.properties.remove(ConnectorSettings.ALLOW_HTTP);
        assertEquals(Kind.NOT_CONFIGURED, refused(connector(), "K1").getKind());
        settings.properties.put(ConnectorSettings.ALLOW_HTTP, "yes");
        assertEquals(Kind.NOT_CONFIGURED, refused(connector(), "K1").getKind());
        assertTrue(stub.received.isEmpty());

        settings.allowHttp();
        stub.answer("/core/claims/K1", Answer.json(RECORD));
        assertEquals(ConnectorAnswer.Status.FOUND, client.fetch(connector(), "K1").status());
        assertEquals(1, stub.received.size());
    }

    @Test
    void anAddressThatIsNotSchemeHostAndPathIsRefused() {
        String hostPort = stub.address().substring("http://".length());
        for (String address : List.of("ftp://" + hostPort, "file:///etc/passwd", "mailto:core@example.invalid",
                "http://user:pass@" + hostPort, "http://" + hostPort + "/?x=1", "http://" + hostPort + "/#f",
                "//" + hostPort, "not an address", "http:///nohost", "jar:http://" + hostPort + "!/")) {
            settings.address(address);
            assertEquals(Kind.NOT_CONFIGURED, refused(connector(), "K1").getKind(), address);
        }
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void theCredentialIsTheServerPropertyElseTheEnvironmentAndNeverInTheAnswer() {
        Connector connector = Connector.of(Fixtures.withCredential(Fixtures.descriptor()));
        stub.answer("/core/claims/K1", Answer.json(RECORD));

        settings.env.put(Fixtures.TOKEN_ENV, "from-the-environment");
        settings.properties.put(Fixtures.TOKEN_PROPERTY, "from-nuxeo-conf");
        String json = client.fetch(connector, "K1").toJson();
        assertEquals("Bearer from-nuxeo-conf", stub.received.get(0).header("Authorization"));
        assertFalse(json.contains("from-nuxeo-conf"));

        settings.properties.remove(Fixtures.TOKEN_PROPERTY);
        client.fetch(connector, "K1");
        assertEquals("Bearer from-the-environment", stub.received.get(1).header("Authorization"));
    }

    @Test
    void aConnectorWhoseCredentialIsMissingSendsNothing() {
        Connector connector = Connector.of(Fixtures.withCredential(Fixtures.descriptor()));
        assertEquals(Kind.NOT_CONFIGURED, refused(connector, "K1").getKind());
        settings.properties.put(Fixtures.TOKEN_PROPERTY, "line\r\nX-Injected: 1");
        assertEquals(Kind.NOT_CONFIGURED, refused(connector, "K1").getKind());
        assertTrue(stub.received.isEmpty());
    }

    @Test
    void aRedirectIsNotFollowed() throws Exception {
        try (SystemOfRecordStub elsewhere = new SystemOfRecordStub()) {
            elsewhere.answer("/claims/K1", Answer.json(RECORD));
            stub.answer("/core/claims/K1", Answer.json("").status(302).header("Location", elsewhere.address() + "/claims/K1"));
            Connector connector = Connector.of(Fixtures.withCredential(Fixtures.descriptor()));
            settings.properties.put(Fixtures.TOKEN_PROPERTY, "only-for-the-core-system");

            assertEquals(Kind.REDIRECTED, refused(connector, "K1").getKind());
            assertTrue(elsewhere.received.isEmpty(), "the redirect was followed");
        }
    }

    @Test
    void aSystemThatDoesNotAnswerInTimeTimesOut() {
        stub.answer("/core/claims/K1", Answer.json(RECORD).delay(3_000));
        Connector connector = connector(d -> d.timeout = 300);

        long started = System.nanoTime();
        assertEquals(Kind.TIMEOUT, refused(connector, "K1").getKind());
        long millis = (System.nanoTime() - started) / 1_000_000;
        assertTrue(millis < 2_000, "took " + millis + " ms");
    }

    @Test
    void aBodyThatStallsIsCutAtTheSameDeadline() {
        stub.answer("/core/claims/K1", Answer.json(RECORD).stallMidBody(3_000));
        Connector connector = connector(d -> d.timeout = 300);

        long started = System.nanoTime();
        assertEquals(Kind.TIMEOUT, refused(connector, "K1").getKind());
        long millis = (System.nanoTime() - started) / 1_000_000;
        assertTrue(millis < 2_000, "took " + millis + " ms");
    }

    @Test
    void aBodyLargerThanTheConnectorAllowsIsRefused() {
        String large = "{ \"paymentStatus\": \"" + "x".repeat(Connector.MIN_MAX_BYTES * 2) + "\" }";
        Connector connector = connector(d -> d.maxBytes = Connector.MIN_MAX_BYTES);

        stub.answer("/core/claims/DECLARED", Answer.json(large));
        assertEquals(Kind.TOO_LARGE, refused(connector, "DECLARED").getKind());

        stub.answer("/core/claims/CHUNKED", Answer.json(large).withoutLength());
        assertEquals(Kind.TOO_LARGE, refused(connector, "CHUNKED").getKind());

        // At the limit exactly, it is read.
        String exact = "{\"paymentStatus\":\"" + "x".repeat(Connector.MIN_MAX_BYTES - 20) + "\"}";
        assertEquals(Connector.MIN_MAX_BYTES, exact.getBytes(StandardCharsets.UTF_8).length);
        stub.answer("/core/claims/EXACT", Answer.json(exact).withoutLength());
        assertEquals(ConnectorAnswer.Status.FOUND, client.fetch(connector, "EXACT").status());
    }

    @Test
    void aDeclaredLengthOverTheLimitIsRefusedBeforeAnyByteIsAskedFor() {
        java.net.http.HttpHeaders headers = java.net.http.HttpHeaders.of(
                java.util.Map.of("Content-Type", List.of("application/json"), "Content-Length", List.of("1025")),
                (name, value) -> true);
        java.net.http.HttpResponse.ResponseInfo info = new java.net.http.HttpResponse.ResponseInfo() {
            @Override
            public int statusCode() {
                return 200;
            }

            @Override
            public java.net.http.HttpHeaders headers() {
                return headers;
            }

            @Override
            public java.net.http.HttpClient.Version version() {
                return java.net.http.HttpClient.Version.HTTP_1_1;
            }
        };
        java.net.http.HttpResponse.BodySubscriber<SystemOfRecordClient.Body> subscriber = SystemOfRecordClient.body(1024)
                                                                                                             .apply(info);
        List<String> calls = new java.util.ArrayList<>();
        subscriber.onSubscribe(new java.util.concurrent.Flow.Subscription() {
            @Override
            public void request(long n) {
                calls.add("request");
            }

            @Override
            public void cancel() {
                calls.add("cancel");
            }
        });

        assertEquals(List.of("cancel"), calls);
        java.util.concurrent.CompletionException failed = assertThrows(java.util.concurrent.CompletionException.class,
                () -> subscriber.getBody().toCompletableFuture().join());
        assertTrue(failed.getCause() instanceof SystemOfRecordClient.TooLarge, failed.toString());
    }

    @Test
    void a404IsNotFoundAndNotAnError() {
        ConnectorAnswer answer = client.fetch(connector(), "MISSING");
        assertEquals(ConnectorAnswer.Status.NOT_FOUND, answer.status());
        assertTrue(answer.fields().isEmpty());
        JsonNode json = parse(answer.toJson());
        assertEquals("not-found", json.get("status").asText());
        assertEquals("test.claimPayments", json.get("connector").asText());
    }

    @Test
    void anyOtherStatusIsRefused() {
        for (int status : List.of(201, 204, 400, 401, 403, 409, 500, 503)) {
            stub.answer("/core/claims/S" + status, Answer.json(RECORD).status(status));
            assertEquals(Kind.REFUSED, refused(connector(), "S" + status).getKind(), String.valueOf(status));
        }
    }

    @Test
    void anAnswerThatIsNotAJsonObjectIsUnreadable() {
        stub.answer("/core/claims/HTML", Answer.json("<html>login</html>").contentType("text/html"));
        stub.answer("/core/claims/NOTYPE", Answer.json(RECORD).contentType(null));
        stub.answer("/core/claims/LIST", Answer.json("[ { \"paymentStatus\": \"Paid\" } ]"));
        stub.answer("/core/claims/BROKEN", Answer.json("{ \"paymentStatus\": "));
        stub.answer("/core/claims/EMPTY", Answer.json(""));
        for (String key : List.of("HTML", "NOTYPE", "LIST", "BROKEN", "EMPTY")) {
            assertEquals(Kind.UNREADABLE, refused(connector(), key).getKind(), key);
        }
        stub.answer("/core/claims/VENDOR", Answer.json(RECORD).contentType("application/vnd.core+json; charset=utf-8"));
        assertEquals(ConnectorAnswer.Status.FOUND, client.fetch(connector(), "VENDOR").status());
    }

    @Test
    void aSystemThatCannotBeReachedIsUnreachable() throws Exception {
        int closed;
        try (ServerSocket socket = new ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            closed = socket.getLocalPort();
        }
        settings.address("http://127.0.0.1:" + closed);
        assertEquals(Kind.UNREACHABLE, refused(connector(), "K1").getKind());
    }

    @Test
    void noFailureNamesTheAddressTheKeyOrTheCredential() {
        Connector connector = Connector.of(Fixtures.withCredential(Fixtures.descriptor()));
        settings.properties.put(Fixtures.TOKEN_PROPERTY, "a-fictional-token");
        stub.answer("/core/claims/SECRET-KEY-1", Answer.json(RECORD).status(500));
        ConnectorException refused = refused(connector, "SECRET-KEY-1");
        for (String hidden : List.of(stub.address(), "SECRET-KEY-1", "a-fictional-token", "/core", "claims")) {
            assertFalse(refused.getMessage().contains(hidden), refused.getMessage());
        }
        assertEquals(502, refused.getStatusCode());
    }

    private static JsonNode parse(String json) {
        try {
            return ConnectorAnswer.JSON.readTree(json);
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }
}
