package org.nuxeo.agentic.embedded;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;

import org.nuxeo.runtime.api.Framework;
import org.nuxeo.runtime.kv.KeyValueService;
import org.nuxeo.runtime.kv.KeyValueStore;

/**
 * The assertions used, in the platform's key-value store, {@value #STORE}: the server's default
 * store's kind unless an administrator configures this one, so shared by every node of a cluster
 * whose default store is (SQL, MongoDB or Redis), and on one node only with the in-memory store. Each
 * is kept by its host and the hash of its id until it expires, plus the clock's skew, and set only if
 * absent, in one step ({@code compareAndSet}), so two exchanges of one assertion at once cannot both
 * be first.
 */
public final class KeyValueReplayGuard implements ReplayGuard {

    static final String STORE = "agenticEmbeddedAssertions";

    @Override
    public boolean firstUse(String host, String assertionId, Instant expiresAt, Instant now) {
        KeyValueStore store = Framework.getService(KeyValueService.class).getKeyValueStore(STORE);
        return store.compareAndSet(key(host, assertionId), null, "used", ttl(expiresAt, now));
    }

    /**
     * How long an assertion's id is kept, in whole seconds, rounded up and one more: never less than
     * the time the verifier still accepts the assertion, its end plus the skew.
     */
    static long ttl(Instant expiresAt, Instant now) {
        Duration left = Duration.between(now, expiresAt.plus(AssertionVerifier.SKEW));
        long seconds = left.getSeconds() + (left.getNano() > 0 ? 1 : 0);
        return Math.max(1, seconds + 1);
    }

    static String key(String host, String assertionId) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(assertionId.getBytes(StandardCharsets.UTF_8));
            return host + ":" + HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
