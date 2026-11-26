package org.nuxeo.agentic.connectors;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertSame;
import static org.nuxeo.agentic.connectors.Claims.ADMIN;
import static org.nuxeo.agentic.connectors.Claims.ALICE;
import static org.nuxeo.agentic.connectors.Claims.BOB;
import static org.nuxeo.agentic.connectors.Claims.KEY_A;
import static org.nuxeo.agentic.connectors.Claims.KEY_B;

import java.time.Duration;

import javax.inject.Inject;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.test.CoreFeature;
import org.nuxeo.runtime.test.runner.Features;
import org.nuxeo.runtime.test.runner.FeaturesRunner;
import org.nuxeo.runtime.transaction.TransactionHelper;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * The cache in a real runtime and repository, through {@code Connector.Read} as the Automation
 * service runs it: a hit, a miss and an expiry, two users with different permissions on the same
 * records, and a read past the cache. Every count is the stand-in core system's own: what it was
 * asked, not what the add-on says it asked.
 */
@RunWith(FeaturesRunner.class)
@Features(ConnectorsFeature.class)
public class CacheRuntimeTest {

    @Inject
    protected CoreSession session;

    @Inject
    protected CoreFeature core;

    private Claims claims;

    @Before
    public void setUp() throws Exception {
        claims = Claims.create(session, core.getRepositoryName());
    }

    @After
    public void tearDown() {
        claims.close();
    }

    @Test
    public void theRuntimeRunsTheComponentAndTheOperationAsItsManifestSays() {
        ConnectorService service = org.nuxeo.runtime.api.Framework.getService(ConnectorService.class);
        assertSame(Claims.component(), service);
        assertNotNull(service.getConnector(Claims.CONNECTOR));
    }

    @Test
    public void aFirstReadIsAMissASecondAHitUntilItsTimeToLive() throws Exception {
        long hits = Claims.counter("cache", "hits");
        long misses = Claims.counter("cache", "misses");

        JsonNode first = claims.read(ALICE, claims.a);
        assertEquals("found", first.path("status").asText());
        assertEquals("Paid", first.at("/fields/paymentStatus").asText());
        assertFalse("the allow-list holds for a kept answer too", first.at("/fields").has("account"));
        assertEquals(0, first.path("age").asLong(-1));
        assertEquals(1, claims.asked(KEY_A));
        assertEquals("Bearer " + claims.token, claims.stub.received.get(0).header("Authorization"));

        claims.clock.advance(Duration.ofSeconds(42));
        JsonNode second = claims.read(ALICE, claims.a);
        assertEquals("Paid", second.at("/fields/paymentStatus").asText());
        assertEquals(42, second.path("age").asLong(-1));
        assertEquals("a hit asks nothing", 1, claims.asked(KEY_A));
        assertEquals(hits + 1, Claims.counter("cache", "hits"));
        assertEquals(misses + 1, Claims.counter("cache", "misses"));

        // At its time to live, 60 seconds on this server, it is asked again.
        claims.clock.advance(Duration.ofSeconds(18));
        JsonNode expired = claims.read(ALICE, claims.a);
        assertEquals(0, expired.path("age").asLong(-1));
        assertEquals(2, claims.asked(KEY_A));
        assertEquals(misses + 2, Claims.counter("cache", "misses"));
    }

    @Test
    public void withNoTimeToLiveOnTheServerEveryReadIsACall() throws Exception {
        Claims.unset(Claims.PREFIX + "cache.ttl");
        long misses = Claims.counter("cache", "misses");
        claims.read(ALICE, claims.a);
        claims.read(ALICE, claims.a);
        assertEquals(2, claims.asked(KEY_A));
        assertEquals("no cache, no miss counted", misses, Claims.counter("cache", "misses"));
    }

    /**
     * Alice's kept answer is never Bob's: he may not read claim A, and is refused before the cache is
     * asked, as he was before there was one. The hit counter shows the cache was not reached. Each
     * reads his or her own claim, and each claim's answer is its own.
     */
    @Test
    public void aKeptAnswerIsNeverGivenToSomeoneWhoMayNotReadItsRecord() throws Exception {
        claims.read(ALICE, claims.a);
        long hits = Claims.counter("cache", "hits");

        assertNotNull(claims.refusal(DocumentSecurityException.class, BOB, claims.a, false));
        assertEquals(hits, Claims.counter("cache", "hits"));
        assertEquals(1, claims.asked(KEY_A));

        assertEquals("Pending", claims.read(BOB, claims.b).at("/fields/paymentStatus").asText());
        assertEquals(1, claims.asked(KEY_B));
        assertNotNull(claims.refusal(DocumentSecurityException.class, ALICE, claims.b, false));
        assertEquals(hits, Claims.counter("cache", "hits"));

        // Both are kept, each for its own record, and each is still its reader's alone.
        assertEquals("Paid", claims.read(ALICE, claims.a).at("/fields/paymentStatus").asText());
        assertEquals("Pending", claims.read(BOB, claims.b).at("/fields/paymentStatus").asText());
        assertEquals(hits + 2, Claims.counter("cache", "hits"));
        assertEquals(1, claims.asked(KEY_A));
        assertEquals(1, claims.asked(KEY_B));
    }

    /** A permission taken away applies at once: the answer is still kept, and still refused. */
    @Test
    public void aRevokedReaderIsRefusedAKeptAnswer() throws Exception {
        claims.read(ALICE, claims.a);
        claims.revoke(ALICE, claims.a);
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
        long hits = Claims.counter("cache", "hits");

        assertNotNull(claims.refusal(DocumentSecurityException.class, ALICE, claims.a, false));
        assertEquals(hits, Claims.counter("cache", "hits"));
        assertEquals(1, Claims.component().cache().size(Claims.CONNECTOR));
    }

    /**
     * Kept per record: Bob's own claim with claim A's number, in a folder of his, is a record of its
     * own, and its first read is a call. That he chooses which outside record his document names is
     * the connector's, as before the cache (the README's "whoever can write the key").
     */
    @Test
    public void anotherDocumentWithTheSameKeyHasAnAnswerOfItsOwn() throws Exception {
        claims.read(ALICE, claims.a);
        DocumentModel folder = session.createDocument(session.createDocumentModel("/", "bobs", "Folder"));
        org.nuxeo.ecm.core.api.security.ACP acp = new org.nuxeo.ecm.core.api.security.impl.ACPImpl();
        acp.getOrCreateACL().add(new org.nuxeo.ecm.core.api.security.ACE(BOB, "Everything", true));
        session.setACP(folder.getRef(), acp, true);
        DocumentModel copy = session.createDocumentModel(folder.getPathAsString(), "copy", "Claim");
        copy.setPropertyValue("claim:number", KEY_A);
        copy = session.createDocument(copy);
        session.save();
        TransactionHelper.commitOrRollbackTransaction();
        TransactionHelper.startTransaction();
        long hits = Claims.counter("cache", "hits");

        assertEquals(0, claims.read(BOB, copy.getRef()).path("age").asLong(-1));
        assertEquals(2, claims.asked(KEY_A));
        assertEquals(hits, Claims.counter("cache", "hits"));
    }

    @Test
    public void aReadPastTheCacheIsAnAdministratorsOnly() throws Exception {
        claims.read(ALICE, claims.a);
        claims.clock.advance(Duration.ofSeconds(10));
        long refreshes = Claims.counter("cache", "refreshes");

        ConnectorException refused = claims.refusal(ConnectorException.class, ALICE, claims.a, true);
        assertNotNull(refused);
        assertEquals(403, refused.getStatusCode());
        assertEquals(1, claims.asked(KEY_A));

        JsonNode fresh = claims.read(ADMIN, claims.a, true);
        assertEquals(0, fresh.path("age").asLong(-1));
        assertEquals(2, claims.asked(KEY_A));
        assertEquals(refreshes + 1, Claims.counter("cache", "refreshes"));
        // What the administrator was given is what is kept now.
        assertEquals(0, claims.read(ALICE, claims.a).path("age").asLong(-1));
        assertEquals(2, claims.asked(KEY_A));
    }
}
