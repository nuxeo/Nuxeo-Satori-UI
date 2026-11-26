package org.nuxeo.agentic.embedded;

import java.time.Instant;
import java.util.Map;

/**
 * Issues a panel's token, and reads one back: {@link PanelTokenCodec}, with the add-on's own key.
 */
public interface TokenCodec {

    /** The claim that names the host a token was exchanged for: what marks a panel's token. */
    String HOST = "nxe_host";

    /** The claim that holds the token's scope: {@code read}, or {@code read write}. */
    String SCOPE = "scope";

    /**
     * What a token is issued for.
     *
     * @param host the host it was exchanged by
     * @param username the Nuxeo user it signs in
     * @param scope {@code read}, or {@code read write}
     * @param id its own id, a random one
     * @param issuedAt when it is issued: its {@code iat}, and the start of its lifetime
     * @param lifetime how long it lives, in seconds
     */
    record Grant(String host, String username, String scope, String id, Instant issuedAt, int lifetime) {

        public Instant expiresAt() {
            return issuedAt.plusSeconds(lifetime);
        }
    }

    /** A token could not be issued: the server is not set up to sign one. */
    final class TokenException extends RuntimeException {

        private static final long serialVersionUID = 1L;

        public TokenException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    String issue(Grant grant);

    /**
     * The token's claims, numbers as longs, once its signature, issuer, audience and end are checked,
     * or {@code null} for a token that is not one this server signed for panels, or has expired.
     */
    Map<String, Object> verify(String token);
}
