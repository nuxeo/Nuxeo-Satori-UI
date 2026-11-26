package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.nuxeo.agentic.connectors.ChangeEvents.Outcome;
import org.nuxeo.agentic.connectors.ChangeEvents.Reason;

import com.fasterxml.jackson.databind.node.TextNode;

/**
 * Who may drop a connector's kept answers, and how often: a signature with the connector's events
 * secret, a timestamp within the window, a nonce not seen before. Every refusal also checks that
 * nothing was dropped. The events reach the servlet over HTTP in {@link ChangeEventRuntimeTest}.
 */
class ChangeEventsTest {

    private final Fixtures.Settings settings = new Fixtures.Settings();

    private final Fixtures.Clock clock = new Fixtures.Clock();

    private final ConnectorCache cache = new ConnectorCache(settings.settings(), clock);

    private final Connector connector = Connector.of(Fixtures.descriptor());

    private final Map<String, Connector> connectors = new HashMap<>(Map.of(connector.id(), connector));

    private final io.dropwizard.metrics5.MetricRegistry registry = new io.dropwizard.metrics5.MetricRegistry();

    private final ChangeEvents events = new ChangeEvents(connectors::get, settings.settings(), cache,
            new ConnectorMetrics(registry));

    private final String secret = Fixtures.generatedSecret();

    private int nonces;

    @BeforeEach
    void keepTwoRecords() {
        settings.ttl("600").eventsSecret(secret);
        keep("doc-1", "CLAIM-1");
        keep("doc-2", "CLAIM-2");
    }

    private void keep(String document, String key) {
        // Asked a moment after any event of the test, so that it is kept.
        clock.advance(Duration.ofMillis(1));
        assertTrue(cache.put(connector, document, key, new ConnectorAnswer(connector.id(),
                ConnectorAnswer.Status.FOUND, Map.of("paymentStatus", TextNode.valueOf("Paid"))), cache.ticket()));
    }

    private String now() {
        return Long.toString(clock.instant().getEpochSecond());
    }

    private String nonce() {
        return "test-nonce-" + String.format("%08d", ++nonces);
    }

    /** As a system of record signs it, written apart from {@link ChangeEvents#mac}. */
    private static String sign(String secret, String connector, String timestamp, String nonce, String body)
            throws Exception {
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] signed = mac.doFinal((connector + "\n" + timestamp + "\n" + nonce + "\n" + body)
                                                                                         .getBytes(StandardCharsets.UTF_8));
        return "sha256=" + HexFormat.of().formatHex(signed);
    }

    private ChangeEvents.Result send(String connector, String timestamp, String nonce, String signature,
            String body) {
        return events.receive(connector, timestamp, nonce, signature, body.getBytes(StandardCharsets.UTF_8));
    }

    private ChangeEvents.Result signed(String timestamp, String nonce, String body) throws Exception {
        return send(connector.id(), timestamp, nonce, sign(secret, connector.id(), timestamp, nonce, body), body);
    }

    private void bothKept() {
        assertNotNull(cache.get(connector, "doc-1", "CLAIM-1"));
        assertNotNull(cache.get(connector, "doc-2", "CLAIM-2"));
    }

    /**
     * A vector computed apart from Java, with {@code openssl dgst -sha256 -hmac}, from a secret
     * derived here, so that the stand-in core system's signer and this one are held to the same
     * bytes. {@code core-system.selftest.mjs} checks the same vector.
     */
    @Test
    void theSignatureIsTheDocumentedHmac() throws Exception {
        String derived = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                                                               .digest("nuxeo-agentic-connectors change event test vector"
                                                                       .getBytes(StandardCharsets.UTF_8)));
        byte[] mac = ChangeEvents.mac(derived, "payers.claimPayments", "1795680000", "Vector-nonce-0123456789",
                "{\"key\":\"CLAIM-000130\"}".getBytes(StandardCharsets.UTF_8));
        assertEquals("e85cd213d24f03096b43f9eb2cdc0dc631a2fcb89d1ef1d118ffe08d8f680056", HexFormat.of().formatHex(mac));
    }

    @Test
    void aSignedEventDropsItsRecordsAnswersAndNoOther() throws Exception {
        ChangeEvents.Result result = signed(now(), nonce(), "{ \"key\": \"CLAIM-1\", \"changed\": \"payment\" }");
        assertEquals(Reason.ACCEPTED, result.reason());
        assertEquals(204, result.outcome().status);
        assertEquals(1, result.invalidated());
        assertNull(cache.get(connector, "doc-1", "CLAIM-1"));
        assertNotNull(cache.get(connector, "doc-2", "CLAIM-2"));
    }

    @Test
    void aBadSignatureIsRefused() throws Exception {
        String timestamp = now();
        String body = "{\"key\":\"CLAIM-1\"}";
        String good = sign(secret, connector.id(), timestamp, "a-nonce-0000000001", body);
        // Another secret, another connector's id, another body, another nonce, one digit changed, and none.
        for (String bad : new String[] { sign(Fixtures.generatedSecret(), connector.id(), timestamp, "a-nonce-0000000001", body),
                sign(secret, "test.other", timestamp, "a-nonce-0000000001", body),
                sign(secret, connector.id(), timestamp, "a-nonce-0000000001", "{\"key\":\"CLAIM-2\"}"),
                sign(secret, connector.id(), timestamp, "a-nonce-0000000002", body),
                good.substring(0, good.length() - 1) + (good.endsWith("0") ? "1" : "0"),
                good.substring("sha256=".length()), "sha1=" + good.substring(7, 47), "", null }) {
            ChangeEvents.Result result = send(connector.id(), timestamp, "a-nonce-0000000001", bad, body);
            assertEquals(Reason.BAD_SIGNATURE, result.reason(), String.valueOf(bad));
            assertEquals(401, result.outcome().status);
        }
        bothKept();
        // A refused event's nonce is not remembered: the signed one still goes through.
        assertEquals(0, events.remembered(connector.id()));
        assertEquals(Reason.ACCEPTED, send(connector.id(), timestamp, "a-nonce-0000000001", good, body).reason());
    }

    @Test
    void anOldTimestampIsRefusedAndSoIsOneFromTooFarAhead() throws Exception {
        long now = clock.instant().getEpochSecond();
        for (long sent : new long[] { now - 301, now - 3600, now + 301, 0 }) {
            assertEquals(Reason.STALE, signed(Long.toString(sent), nonce(), "{\"key\":\"CLAIM-1\"}").reason());
        }
        for (String malformed : new String[] { null, "", "-5", "12.5", "1795680000000000", "soon" }) {
            assertEquals(Reason.NO_TIMESTAMP, signed(malformed, nonce(), "{\"key\":\"CLAIM-1\"}").reason());
        }
        bothKept();
        // The clock is a few milliseconds past `now`'s second: 299 whole seconds back is inside.
        assertEquals(Reason.ACCEPTED, signed(Long.toString(now - 299), nonce(), "{\"key\":\"CLAIM-1\"}").reason());
    }

    @Test
    void aReplayedNonceIsRefusedWhileItsTimestampCouldBeAccepted() throws Exception {
        String timestamp = now();
        String body = "{\"key\":\"CLAIM-1\"}";
        String signature = sign(secret, connector.id(), timestamp, "replayed-nonce-001", body);
        assertEquals(Reason.ACCEPTED, send(connector.id(), timestamp, "replayed-nonce-001", signature, body).reason());
        keep("doc-1", "CLAIM-1");

        clock.advance(Duration.ofSeconds(299));
        ChangeEvents.Result again = send(connector.id(), timestamp, "replayed-nonce-001", signature, body);
        assertEquals(Reason.REPLAYED, again.reason());
        assertEquals(401, again.outcome().status);
        bothKept();

        // Past the window, the same bytes are too old to be accepted, whatever the nonce.
        clock.advance(Duration.ofSeconds(2));
        assertEquals(Reason.STALE, send(connector.id(), timestamp, "replayed-nonce-001", signature, body).reason());
        bothKept();
    }

    /**
     * Copies of one signed event, sent at once, are one event: the nonce is looked up and remembered
     * under one lock, here on the branch where it was seen so long ago that it could be used again.
     */
    @Test
    void copiesOfOneEventSentAtOnceAreAcceptedOnce() throws Exception {
        String body = "{\"key\":\"CLAIM-1\"}";
        assertEquals(Reason.ACCEPTED, signed(now(), "reused-nonce-000001", body).reason());
        // An event just before the first one's nonce expires purges the store and keeps it; two
        // seconds later it has expired, and no purge is due for a minute: it is still there.
        clock.advance(Duration.ofSeconds(ChangeEvents.WINDOW_SECONDS - 1));
        assertEquals(Reason.ACCEPTED, signed(now(), nonce(), body).reason());
        clock.advance(Duration.ofSeconds(2));
        assertEquals(2, events.remembered(connector.id()));
        String timestamp = now();
        String signature = sign(secret, connector.id(), timestamp, "reused-nonce-000001", body);
        int copies = 16;
        java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
        java.util.List<java.util.concurrent.Future<Reason>> sent = new java.util.ArrayList<>();
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(copies);
        try {
            for (int i = 0; i < copies; i++) {
                sent.add(pool.submit(() -> {
                    go.await();
                    return send(connector.id(), timestamp, "reused-nonce-000001", signature, body).reason();
                }));
            }
            go.countDown();
            int accepted = 0;
            for (java.util.concurrent.Future<Reason> each : sent) {
                Reason reason = each.get();
                if (reason == Reason.ACCEPTED) {
                    accepted++;
                } else {
                    assertEquals(Reason.REPLAYED, reason);
                }
            }
            assertEquals(1, accepted);
        } finally {
            pool.shutdownNow();
        }
    }

    /** Expired nonces are forgotten once a minute, not only once the store is full. */
    @Test
    void expiredNoncesAreForgottenWithoutWaitingForTheStoreToFill() throws Exception {
        for (int i = 0; i < 5; i++) {
            assertEquals(Reason.ACCEPTED, signed(now(), nonce(), "{\"key\":\"CLAIM-9\"}").reason());
        }
        assertEquals(5, events.remembered(connector.id()));
        clock.advance(Duration.ofSeconds(ChangeEvents.WINDOW_SECONDS).plus(ChangeEvents.PURGE_EVERY));
        assertEquals(Reason.ACCEPTED, signed(now(), nonce(), "{\"key\":\"CLAIM-9\"}").reason());
        assertEquals(1, events.remembered(connector.id()));
    }

    @Test
    void aNonceMustBeOfItsForm() throws Exception {
        for (String nonce : new String[] { null, "", "short", "has space in it 01", "x".repeat(129), "nonce/with/slashes" }) {
            assertEquals(Reason.NO_NONCE, signed(now(), nonce, "{\"key\":\"CLAIM-1\"}").reason(), String.valueOf(nonce));
        }
        bothKept();
    }

    @Test
    void anUnknownConnectorAndOneWithNoSecretAreRefusedAlike() throws Exception {
        assertEquals(Reason.UNKNOWN_CONNECTOR, send("test.other", now(), nonce(), "sha256=00", "{}").reason());
        assertEquals(Reason.UNKNOWN_CONNECTOR, send("../test.claimPayments", now(), nonce(), "sha256=00", "{}").reason());
        assertEquals(Reason.UNKNOWN_CONNECTOR, send(null, now(), nonce(), "sha256=00", "{}").reason());
        // Counted under a tag no connector id can be, never under what the request named.
        assertEquals(3, registry.counter(ConnectorMetrics.name("events", "refused", "(unknown)")
                                                         .tagged("reason", "unknown_connector"))
                                .getCount());
        assertTrue(registry.getNames().stream().noneMatch(name -> name.toString().contains("test.other")));
        assertTrue(!Connector.ID.matcher(ConnectorMetrics.UNKNOWN).matches());

        settings.eventsSecret("too-short-a-secret-0123456789ab");
        ChangeEvents.Result shortSecret = signed(now(), nonce(), "{\"key\":\"CLAIM-1\"}");
        assertEquals(Reason.NO_SECRET, shortSecret.reason());
        settings.properties.remove(Fixtures.EVENTS_SECRET);
        assertEquals(Reason.NO_SECRET, signed(now(), nonce(), "{\"key\":\"CLAIM-1\"}").reason());
        for (Reason refused : new Reason[] { Reason.UNKNOWN_CONNECTOR, Reason.NO_SECRET }) {
            assertEquals(Outcome.REFUSED, refused.outcome);
        }
        bothKept();
    }

    @Test
    void aSignedBodyThatIsNotAnEventIsMalformedAndDropsNothing() throws Exception {
        for (String body : new String[] { "", "[]", "{}", "{\"key\":42}", "{\"key\":\"../CLAIM-1\"}",
                "{\"key\":\"CLAIM-1\"} {\"key\":\"CLAIM-2\"}", "not json" }) {
            ChangeEvents.Result result = signed(now(), nonce(), body);
            assertEquals(Reason.NOT_AN_EVENT, result.reason(), body);
            assertEquals(400, result.outcome().status);
        }
        bothKept();
    }

    @Test
    void aBodyOverTheLimitIsRefusedUnsigned() throws Exception {
        String body = "{\"key\":\"CLAIM-1\",\"pad\":\"" + "x".repeat(ChangeEvents.MAX_BODY_BYTES) + "\"}";
        ChangeEvents.Result result = signed(now(), nonce(), body);
        assertEquals(Reason.TOO_LARGE, result.reason());
        assertEquals(413, result.outcome().status);
        bothKept();
    }

    @Test
    void atMostSoManyNoncesAreRememberedPerConnector() throws Exception {
        for (int i = 0; i < ChangeEvents.MAX_NONCES; i++) {
            assertEquals(Reason.ACCEPTED, signed(now(), nonce(), "{\"key\":\"CLAIM-9\"}").reason());
        }
        ChangeEvents.Result full = signed(now(), nonce(), "{\"key\":\"CLAIM-1\"}");
        assertEquals(Reason.TOO_MANY_NONCES, full.reason());
        assertEquals(503, full.outcome().status);
        bothKept();
        // Once the first ones' timestamps could no longer be accepted, they are forgotten.
        clock.advance(Duration.ofSeconds(ChangeEvents.WINDOW_SECONDS + 1));
        assertEquals(Reason.ACCEPTED, signed(now(), nonce(), "{\"key\":\"CLAIM-1\"}").reason());
        assertTrue(events.remembered(connector.id()) < 10);
    }
}
