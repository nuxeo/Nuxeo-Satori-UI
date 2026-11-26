package org.nuxeo.agentic.embedded;

import java.time.Instant;

/**
 * Remembers each assertion a host exchanged until it expires, so that it is exchanged once: a second
 * use of its id by the same host is a replay.
 */
public interface ReplayGuard {

    /**
     * Records the assertion's first use, and says whether this is it.
     *
     * @return {@code true} the first time, {@code false} for any later use while it is remembered
     */
    boolean firstUse(String host, String assertionId, Instant expiresAt, Instant now);
}
