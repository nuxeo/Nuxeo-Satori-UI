package org.nuxeo.agentic.embedded;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;

import org.junit.jupiter.api.Test;

/** How long an assertion's id is kept, and under which key: never shorter than it is accepted. */
class KeyValueReplayGuardTest {

    @Test
    void anIdIsKeptAtLeastAsLongAsTheVerifierAcceptsTheAssertion() {
        Instant now = Fixtures.NOW;
        // 110 s left and 30 s of skew: 140 s accepted, kept 141.
        assertEquals(141, KeyValueReplayGuard.ttl(now.plusSeconds(110), now));
        // A fraction of a second rounds up, then one more.
        assertEquals(142, KeyValueReplayGuard.ttl(now.plusSeconds(110).plusMillis(1), now));
        for (long millis = 0; millis < 2000; millis += 137) {
            Instant at = now.plusMillis(millis);
            Instant expires = now.plusSeconds(100);
            long kept = KeyValueReplayGuard.ttl(expires, at);
            Instant acceptedUntil = expires.plus(AssertionVerifier.SKEW);
            assertTrue(!at.plusSeconds(kept).isBefore(acceptedUntil), "kept " + kept + " s from " + at);
        }
        // Expired long ago: still one second, the store's least.
        assertEquals(1, KeyValueReplayGuard.ttl(now.minusSeconds(3600), now));
    }

    @Test
    void theKeyIsTheHostsAndTheIdsHash() {
        String key = KeyValueReplayGuard.key("crm", "a-1");
        assertTrue(key.startsWith("crm:"));
        assertEquals(4 + 64, key.length());
        assertNotEquals(key, KeyValueReplayGuard.key("erp", "a-1"));
        assertNotEquals(key, KeyValueReplayGuard.key("crm", "a-2"));
    }
}
