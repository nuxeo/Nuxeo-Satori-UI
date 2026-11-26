package org.nuxeo.agentic.connectors;

import static org.junit.Assert.assertEquals;
import static org.nuxeo.agentic.connectors.Claims.ALICE;
import static org.nuxeo.agentic.connectors.Claims.BOB;
import static org.nuxeo.agentic.connectors.Claims.KEY_A;
import static org.nuxeo.agentic.connectors.Claims.KEY_B;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import javax.inject.Inject;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.agentic.connectors.SystemOfRecordStub.Event;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;

/**
 * Change events sent by the stand-in core system over HTTP, to the change events' servlet as Nuxeo
 * maps it ({@link ServletBridge}), in a real runtime and repository. An event drops its own record's
 * kept answers and no other's; one with a bad signature, an old timestamp or a nonce already used
 * is refused, and drops nothing; none writes a document.
 */
@RunWith(FeaturesRunner.class)
@Features(ConnectorsFeature.class)
public class ChangeEventRuntimeTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private Claims claims;

    private ServletBridge nuxeo;

    private String secret;

    @Before
    public void setUp() throws Exception {
        claims = Claims.create(session, core.getRepositoryName());
        secret = Fixtures.generatedSecret();
        Claims.set(Claims.PREFIX + "events.secret", secret);
        nuxeo = new ServletBridge();
        // Alice's claim A and Bob's claim B, each kept.
        claims.read(ALICE, claims.a);
        claims.read(BOB, claims.b);
        assertEquals(2, Claims.component().cache().size(Claims.CONNECTOR));
    }

    @After
    public void tearDown() {
        nuxeo.close();
        claims.close();
    }

    private Event about(String key) {
        return Event.about(Claims.CONNECTOR, key, claims.clock);
    }

    private int send(Event event) throws Exception {
        return SystemOfRecordStub.send(nuxeo.events(), event, event.signature(secret));
    }

    /** Both kept answers are still given, and the stand-in was asked for each once only. */
    private void bothStillKept() throws Exception {
        assertEquals(KEY_A, 1, claims.asked(KEY_A));
        assertEquals(KEY_B, 1, claims.asked(KEY_B));
        claims.read(ALICE, claims.a);
        claims.read(BOB, claims.b);
        assertEquals(KEY_A, 1, claims.asked(KEY_A));
        assertEquals(KEY_B, 1, claims.asked(KEY_B));
    }

    @Test
    public void anEventDropsItsOwnRecordsAnswersAndNoOther() throws Exception {
        long accepted = Claims.counter("events", "accepted");
        long invalidated = Claims.counter("cache", "invalidated");

        assertEquals(204, send(about(KEY_A)));
        assertEquals(accepted + 1, Claims.counter("events", "accepted"));
        assertEquals(invalidated + 1, Claims.counter("cache", "invalidated"));

        assertEquals(0, claims.read(ALICE, claims.a).path("age").asLong(-1));
        assertEquals("claim A is asked again", 2, claims.asked(KEY_A));
        claims.read(BOB, claims.b);
        assertEquals("claim B is still kept", 1, claims.asked(KEY_B));
    }

    @Test
    public void aBadSignatureIsRefusedAndDropsNothing() throws Exception {
        Event event = about(KEY_A);
        assertEquals(401, SystemOfRecordStub.send(nuxeo.events(), event, event.signature(Fixtures.generatedSecret())));
        assertEquals(401, SystemOfRecordStub.send(nuxeo.events(), event, null));
        // Signed for claim B, sent about claim A.
        Event other = about(KEY_B);
        assertEquals(401, SystemOfRecordStub.send(nuxeo.events(),
                new Event(event.connector(), event.timestamp(), event.nonce(), event.body()),
                new Event(other.connector(), event.timestamp(), event.nonce(), other.body()).signature(secret)));
        bothStillKept();
    }

    @Test
    public void anOldTimestampIsRefusedAndDropsNothing() throws Exception {
        long now = claims.clock.instant().getEpochSecond();
        assertEquals(401, send(about(KEY_A).at(Long.toString(now - 301))));
        assertEquals(401, send(about(KEY_A).at(Long.toString(now - 86_400))));
        assertEquals(401, send(about(KEY_A).at(Long.toString(now + 301))));
        bothStillKept();
    }

    @Test
    public void aReplayedNonceIsRefusedAndDropsNothing() throws Exception {
        Event event = about(KEY_A);
        String signature = event.signature(secret);
        assertEquals(204, SystemOfRecordStub.send(nuxeo.events(), event, signature));
        // Asked after the event, so its answer is kept.
        claims.clock.advance(Duration.ofSeconds(1));
        claims.read(ALICE, claims.a);
        assertEquals(2, claims.asked(KEY_A));

        claims.clock.advance(Duration.ofSeconds(30));
        assertEquals(401, SystemOfRecordStub.send(nuxeo.events(), event, signature));
        claims.read(ALICE, claims.a);
        assertEquals("the replay dropped nothing", 2, claims.asked(KEY_A));
    }

    @Test
    public void anEventForAConnectorWithNoSecretOrNoneAtAllIsRefused() throws Exception {
        assertEquals(401, SystemOfRecordStub.send(nuxeo.events(),
                Event.about("test.unknown", KEY_A, claims.clock), about(KEY_A).signature(secret)));
        Claims.unset(Claims.PREFIX + "events.secret");
        assertEquals(401, send(about(KEY_A)));
        bothStillKept();
    }

    @Test
    public void theServletTakesAPostToOneConnectorsPathOnly() throws Exception {
        java.net.http.HttpClient client = java.net.http.HttpClient.newHttpClient();
        java.net.http.HttpResponse<Void> get = client.send(
                java.net.http.HttpRequest.newBuilder(java.net.URI.create(nuxeo.events() + "/" + Claims.CONNECTOR))
                                         .GET()
                                         .build(),
                java.net.http.HttpResponse.BodyHandlers.discarding());
        assertEquals(405, get.statusCode());
        assertEquals("POST", get.headers().firstValue("Allow").orElse(""));
        Event event = about(KEY_A);
        assertEquals(404, SystemOfRecordStub.send(nuxeo.events() + "/more",
                new Event(Claims.CONNECTOR, event.timestamp(), event.nonce(), event.body()), event.signature(secret)));
        Event large = new Event(Claims.CONNECTOR, event.timestamp(), event.nonce(),
                "{\"key\":\"" + KEY_A + "\",\"pad\":\"" + "x".repeat(ChangeEvents.MAX_BODY_BYTES) + "\"}");
        assertEquals(413, SystemOfRecordStub.send(nuxeo.events(), large, large.signature(secret)));
        client.close();
        bothStillKept();
    }

    /**
     * A body sent with no length, in chunks, is read up to one byte past the bound and no further,
     * and refused: the servlet does not take a whole body before it decides.
     */
    @Test
    public void aChunkedBodyOverTheBoundIsReadNoFurtherThanTheBound() throws Exception {
        Event event = about(KEY_A);
        byte[] large = ("{\"key\":\"" + KEY_A + "\",\"pad\":\"" + "x".repeat(64 * 1024) + "\"}")
                                                                                              .getBytes(java.nio.charset.StandardCharsets.UTF_8);
        try (java.net.http.HttpClient client = java.net.http.HttpClient.newHttpClient()) {
            java.net.http.HttpRequest request = java.net.http.HttpRequest
                                                                         .newBuilder(java.net.URI.create(
                                                                                 nuxeo.events() + "/" + Claims.CONNECTOR))
                                                                         .header("X-Nuxeo-Connector-Timestamp",
                                                                                 event.timestamp())
                                                                         .header("X-Nuxeo-Connector-Nonce", event.nonce())
                                                                         .header("X-Nuxeo-Connector-Signature",
                                                                                 event.signature(secret))
                                                                         .POST(java.net.http.HttpRequest.BodyPublishers.ofInputStream(
                                                                                 () -> new java.io.ByteArrayInputStream(large)))
                                                                         .build();
            assertEquals(413, client.send(request, java.net.http.HttpResponse.BodyHandlers.discarding()).statusCode());
        }
        long read = nuxeo.lastRead.get();
        org.junit.Assert.assertTrue("read " + read + " bytes", read > 0 && read <= ChangeEvents.MAX_BODY_BYTES + 1);
        bothStillKept();
    }

    /**
     * An event writes nothing: every document of the repository, its change token and its
     * modification date, is as it was before a burst of accepted and refused events.
     */
    @Test
    public void anEventWritesNoDocument() throws Exception {
        Map<String, String> before = documents();
        assertEquals(204, send(about(KEY_A)));
        assertEquals(204, send(about(KEY_B)));
        assertEquals(401, SystemOfRecordStub.send(nuxeo.events(), about(KEY_A), "sha256=" + "0".repeat(64)));
        assertEquals(before, documents());
    }

    private Map<String, String> documents() {
        Map<String, String> seen = new HashMap<>();
        for (DocumentModel document : claims.as(Claims.ADMIN).query("SELECT * FROM Document")) {
            seen.put(document.getId(), document.getChangeToken() + " " + document.getPropertyValue("dc:modified"));
        }
        assertEquals("the folder and its two claims", 3, seen.size());
        return seen;
    }
}
