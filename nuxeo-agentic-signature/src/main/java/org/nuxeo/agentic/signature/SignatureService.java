/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.time.Duration;

/** The e-signature service: the providers, the one in use, and the add-on's claims across the cluster. */
public interface SignatureService {

    /** A registered provider, by id, made and given its settings; {@code null} for none. */
    SignatureProvider provider(String id);

    /**
     * The id of the provider requests are sent through, as the server's
     * {@value SignatureSettings#PROVIDER_PROPERTY} names it, when it is registered; {@code null} otherwise.
     */
    String activeProviderId();

    /**
     * How far a callback's time may be from the server's, either way: 5 minutes unless the server sets
     * {@code nuxeo.agentic.signature.callback.window}, in seconds, 30 to 3600.
     */
    Duration callbackWindow();

    /**
     * Claim {@code key} for {@code value}, across the cluster, for {@code ttlSeconds}; {@code false}
     * when it is claimed already. With {@code releaseUnlessCommitted}, the claim is released when
     * the current transaction ends without committing.
     */
    boolean claim(String key, String value, long ttlSeconds, boolean releaseUnlessCommitted);

    /** Release a claim, whoever holds it. */
    void release(String key);
}
