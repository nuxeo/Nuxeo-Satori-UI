package org.nuxeo.agentic.connectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.node.TextNode;

/**
 * The cache on its own: what turns it on, what an answer is kept under, how long, how many, and
 * what drops it. Who may be given a kept answer is {@link ConnectorReader}'s, and is tested there
 * and in {@link CacheRuntimeTest}, with a real repository's permissions.
 */
class ConnectorCacheTest {

    private final Fixtures.Settings settings = new Fixtures.Settings();

    private final Fixtures.Clock clock = new Fixtures.Clock();

    private final ConnectorCache cache = new ConnectorCache(settings.settings(), clock);

    private final Connector connector = Connector.of(Fixtures.descriptor());

    private static ConnectorAnswer paid(String status) {
        return new ConnectorAnswer("test.claimPayments", ConnectorAnswer.Status.FOUND,
                Map.of("paymentStatus", TextNode.valueOf(status)));
    }

    /** An answer the system gave now, asked now. */
    private boolean keep(String document, String key, ConnectorAnswer answer) {
        return cache.put(connector, document, key, answer, cache.ticket());
    }

    private void bothIndexed() {
        assertEquals(cache.size(connector.id()), cache.indexed(connector.id()), "the key index and the shelf agree");
    }

    @Test
    void offUnlessTheServerSetsATimeToLive() {
        assertFalse(keep("doc-1", "CLAIM-1", paid("Paid")));
        assertNull(cache.get(connector, "doc-1", "CLAIM-1"));
        assertEquals(0, cache.size(connector.id()));

        for (String wrong : new String[] { "0", "-5", "86401", "ten", "1.5", "" }) {
            settings.ttl(wrong);
            assertNull(cache.ttl(connector), wrong);
            keep("doc-1", "CLAIM-1", paid("Paid"));
            assertEquals(0, cache.size(connector.id()), wrong);
        }
        settings.ttl("86400");
        assertEquals(Duration.ofDays(1), cache.ttl(connector));
    }

    @Test
    void aHitUntilItsTimeToLiveHasPassedThenAMiss() {
        settings.ttl("30");
        assertTrue(keep("doc-1", "CLAIM-1", paid("Paid")));

        clock.advance(Duration.ofSeconds(29));
        ConnectorCache.Hit hit = cache.get(connector, "doc-1", "CLAIM-1");
        assertNotNull(hit);
        assertEquals(Duration.ofSeconds(29), hit.age());
        assertEquals("Paid", hit.answer().fields().get("paymentStatus").asText());

        clock.advance(Duration.ofSeconds(1));
        assertNull(cache.get(connector, "doc-1", "CLAIM-1"), "expired at its time to live");
        assertEquals(0, cache.size(connector.id()), "an expired answer is dropped when it is found");
        bothIndexed();
    }

    @Test
    void aShorterTimeSetOnTheServerAppliesToWhatIsAlreadyKept() {
        settings.ttl("300");
        keep("doc-1", "CLAIM-1", paid("Paid"));
        clock.advance(Duration.ofSeconds(90));
        assertNotNull(cache.get(connector, "doc-1", "CLAIM-1"));
        settings.ttl("60");
        assertNull(cache.get(connector, "doc-1", "CLAIM-1"));
    }

    /** An answer is as old as when the system was asked, not when its answer came back. */
    @Test
    void anAnswerIsAsOldAsWhenItWasAsked() {
        settings.ttl("60");
        ConnectorCache.Ticket asked = cache.ticket();
        clock.advance(Duration.ofSeconds(4));
        assertTrue(cache.put(connector, "doc-1", "CLAIM-1", paid("Paid"), asked));
        assertEquals(Duration.ofSeconds(4), cache.get(connector, "doc-1", "CLAIM-1").age());
    }

    /** Per connector, document and key: an answer is never given for another document, or another key. */
    @Test
    void keptPerDocumentPerKeyAndPerConnectorDefinition() {
        settings.ttl("60");
        keep("doc-1", "CLAIM-1", paid("Paid"));

        assertNull(cache.get(connector, "doc-2", "CLAIM-1"), "another document with the same key");
        assertNull(cache.get(connector, "doc-1", "CLAIM-2"), "the same document, its key changed");
        ConnectorDescriptor more = Fixtures.descriptor();
        more.fields.add(Fixtures.field("bankAccount", null));
        assertNull(cache.get(Connector.of(more), "doc-1", "CLAIM-1"),
                "the connector contributed again with another field");
        assertNotNull(cache.get(Connector.of(Fixtures.descriptor()), "doc-1", "CLAIM-1"),
                "an equal definition is the same connector");
    }

    @Test
    void onlyAnswersTheSystemGaveAreKept() {
        settings.ttl("60");
        assertFalse(keep("doc-1", "CLAIM-1", ConnectorAnswer.without(connector.id(), ConnectorAnswer.Status.NO_KEY)));
        assertNull(cache.get(connector, "doc-1", "CLAIM-1"));
        keep("doc-1", "CLAIM-1", ConnectorAnswer.without(connector.id(), ConnectorAnswer.Status.NOT_FOUND));
        assertEquals(ConnectorAnswer.Status.NOT_FOUND, cache.get(connector, "doc-1", "CLAIM-1").answer().status());
    }

    @Test
    void atMostMaxEntriesTheFirstKeptDroppedFirst() {
        settings.ttl("600");
        settings.properties.put(Fixtures.CACHE_MAX_ENTRIES, "3");
        for (int i = 1; i <= 4; i++) {
            keep("doc-" + i, "CLAIM-" + i, paid("Paid"));
            clock.advance(Duration.ofSeconds(1));
        }
        assertEquals(3, cache.size(connector.id()));
        assertNull(cache.get(connector, "doc-1", "CLAIM-1"));
        assertNotNull(cache.get(connector, "doc-4", "CLAIM-4"));
        bothIndexed();
        assertEquals(0, cache.invalidate(connector, "CLAIM-1"), "a dropped answer is out of the index too");

        settings.properties.put(Fixtures.CACHE_MAX_ENTRIES, "0");
        assertEquals(ConnectorCache.DEFAULT_MAX_ENTRIES, cache.maxEntries(connector));
        settings.properties.put(Fixtures.CACHE_MAX_ENTRIES, "100001");
        assertEquals(ConnectorCache.DEFAULT_MAX_ENTRIES, cache.maxEntries(connector));
    }

    @Test
    void anExpiredAnswerIsDroppedWhenAnotherIsKept() {
        settings.ttl("10");
        keep("doc-1", "CLAIM-1", paid("Paid"));
        clock.advance(Duration.ofSeconds(11));
        keep("doc-2", "CLAIM-2", paid("Paid"));
        assertEquals(1, cache.size(connector.id()));
        bothIndexed();
    }

    /** An event names a key: every document's answer for it goes, and no other key's. */
    @Test
    void invalidatingAKeyDropsItsAnswersOnly() {
        settings.ttl("60");
        keep("doc-1", "CLAIM-1", paid("Paid"));
        keep("doc-1-copy", "CLAIM-1", paid("Paid"));
        keep("doc-2", "CLAIM-2", paid("Pending"));

        assertEquals(2, cache.invalidate(connector, "CLAIM-1"));
        assertNull(cache.get(connector, "doc-1", "CLAIM-1"));
        assertNull(cache.get(connector, "doc-1-copy", "CLAIM-1"));
        assertNotNull(cache.get(connector, "doc-2", "CLAIM-2"));
        assertEquals(0, cache.invalidate(connector, "CLAIM-1"));
        bothIndexed();
    }

    /**
     * A call on its way when the event came keeps nothing: the system may have answered before its
     * record changed. A call asked after the event keeps its answer.
     */
    @Test
    void aCallOnItsWayWhenAnEventCameKeepsNothing() {
        settings.ttl("60");
        ConnectorCache.Ticket asked = cache.ticket();
        clock.advance(Duration.ofSeconds(2));
        assertEquals(0, cache.invalidate(connector, "CLAIM-1"), "the event, while the call is on its way");
        clock.advance(Duration.ofSeconds(1));
        assertFalse(cache.put(connector, "doc-1", "CLAIM-1", paid("Paid before the change"), asked));
        assertNull(cache.get(connector, "doc-1", "CLAIM-1"));

        // Another key, asked at the same time, is not touched by that event.
        assertTrue(cache.put(connector, "doc-2", "CLAIM-2", paid("Pending"), asked));

        assertTrue(keep("doc-1", "CLAIM-1", paid("Paid after the change")));
        assertEquals("Paid after the change",
                cache.get(connector, "doc-1", "CLAIM-1").answer().fields().get("paymentStatus").asText());
    }

    /** A slow call that comes back after a later one does not replace the later one's answer. */
    @Test
    void aLaterAnswerIsNotReplacedByAnEarlierOne() {
        settings.ttl("60");
        ConnectorCache.Ticket first = cache.ticket();
        clock.advance(Duration.ofSeconds(3));
        assertTrue(keep("doc-1", "CLAIM-1", paid("Refreshed")));
        assertFalse(cache.put(connector, "doc-1", "CLAIM-1", paid("Stale"), first));
        assertEquals("Refreshed", cache.get(connector, "doc-1", "CLAIM-1").answer().fields().get("paymentStatus").asText());
    }

    /** An event is remembered for longer than any call may last, then forgotten. */
    @Test
    void anEventIsRememberedLongerThanTheLongestCall() {
        settings.ttl("600");
        ConnectorCache.Ticket asked = cache.ticket();
        cache.invalidate(connector, "CLAIM-1");
        clock.advance(Duration.ofMillis(Connector.MAX_TIMEOUT_MS));
        assertFalse(cache.put(connector, "doc-1", "CLAIM-1", paid("Paid"), asked));
        assertTrue(ConnectorCache.EVENT_MEMORY.compareTo(Duration.ofMillis(Connector.MAX_TIMEOUT_MS)) > 0);
    }

    /** Which came first is the tickets' order, not the clock's: a clock set back changes nothing. */
    @Test
    void aClockSetBackDoesNotLetAnAnswerFromBeforeAnEventIn() {
        settings.ttl("600");
        ConnectorCache.Ticket asked = cache.ticket();
        clock.advance(Duration.ofSeconds(-20));
        cache.invalidate(connector, "CLAIM-1");
        assertFalse(cache.put(connector, "doc-1", "CLAIM-1", paid("Paid before the change"), asked));
        assertTrue(keep("doc-1", "CLAIM-1", paid("Paid after the change")));
    }

    /** A connector contributed again, as hot reload does, still remembers the events sent lately. */
    @Test
    void aConnectorContributedAgainRemembersItsEvents() {
        settings.ttl("600");
        ConnectorCache.Ticket asked = cache.ticket();
        cache.invalidate(connector, "CLAIM-1");
        cache.forget(connector.id());
        assertFalse(cache.put(connector, "doc-1", "CLAIM-1", paid("Paid before the change"), asked));
        assertTrue(keep("doc-1", "CLAIM-1", paid("Paid after the change")));
    }

    /**
     * Past the bound, what has expired goes first, wherever it is: a slow call's answer is as old as
     * when it was asked, and may sit behind a younger one that is still good.
     */
    @Test
    void pastTheBoundAnExpiredAnswerGoesBeforeAGoodOne() {
        settings.ttl("10");
        settings.properties.put(Fixtures.CACHE_MAX_ENTRIES, "2");
        ConnectorCache.Ticket slow = cache.ticket();
        clock.advance(Duration.ofSeconds(5));
        assertTrue(keep("doc-a", "CLAIM-A", paid("Good")));
        clock.advance(Duration.ofSeconds(6));
        // The slow call comes back expired, and is kept after the good one.
        cache.put(connector, "doc-slow", "CLAIM-S", paid("Slow"), slow);
        assertTrue(keep("doc-b", "CLAIM-B", paid("Good")));
        assertNotNull(cache.get(connector, "doc-a", "CLAIM-A"), "the good one is kept");
        assertNotNull(cache.get(connector, "doc-b", "CLAIM-B"));
        assertEquals(2, cache.size(connector.id()));
        bothIndexed();
    }

    @Test
    void aConnectorContributedAgainOrRemovedLosesItsAnswers() {
        settings.ttl("60");
        ConnectorComponent component = new ConnectorComponent();
        component.register(Fixtures.descriptor(), "kit");
        component.start(settings.settings(), clock, Fixtures.metrics());
        ConnectorCache running = component.cache();
        running.put(component.getConnector("test.claimPayments"), "doc-1", "CLAIM-1", paid("Paid"), running.ticket());
        assertEquals(1, running.size("test.claimPayments"));

        ConnectorDescriptor replacement = Fixtures.descriptor();
        replacement.path = "/v2/claims/{key}";
        component.register(replacement, "later-kit");
        assertEquals(0, running.size("test.claimPayments"));

        running.put(component.getConnector("test.claimPayments"), "doc-1", "CLAIM-1", paid("Paid"), running.ticket());
        ConnectorDescriptor disabled = new ConnectorDescriptor();
        disabled.id = "test.claimPayments";
        disabled.enabled = false;
        component.register(disabled, "customer");
        assertEquals(0, running.size("test.claimPayments"));
        component.stop(null);
    }
}
