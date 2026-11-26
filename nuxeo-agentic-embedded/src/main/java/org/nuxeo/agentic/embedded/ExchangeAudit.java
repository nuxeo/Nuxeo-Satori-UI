package org.nuxeo.agentic.embedded;

import java.time.Instant;

/**
 * Records every exchange in the platform's audit: each token issued, and each refusal for a host that
 * authenticated or named itself. Never a token, an assertion or a secret.
 */
public interface ExchangeAudit {

    /** The event of a token issued. */
    String ISSUED = "agenticEmbeddedTokenIssued";

    /** The event of an exchange refused, for a registered host. */
    String REFUSED = "agenticEmbeddedTokenRefused";

    /** The category of both. */
    String CATEGORY = "agenticEmbedded";

    void issued(String host, String username, String subject, String scope, String tokenId, Instant expiresAt);

    /**
     * @param host the registered host the request named
     * @param reason a short, fixed word: never anything the request carried
     */
    void refused(String host, String reason);
}
