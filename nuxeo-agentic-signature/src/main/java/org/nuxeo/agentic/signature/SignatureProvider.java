/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.util.List;

/**
 * An e-signature service, as the add-on speaks to one: provider-neutral, so that the service chosen
 * with procurement and presales (decision H) is one class more, registered at
 * {@code org.nuxeo.agentic.signature}'s {@code providers} point, and nothing else of the add-on
 * changes.
 *
 * <p>The add-on keeps what does not depend on the provider: who may send what, a request's states,
 * the claim that one record has one request out at a time, that a callback is fresh and taken once,
 * and filing the signed file as a new version. A provider keeps what does: how a file is sent, how
 * its callback is authenticated and read, and how the signed file and its evidence are fetched.
 *
 * <p>An implementation:
 * <ul>
 * <li>reads its address and credentials from {@link SignatureSettings} only, under
 * {@code nuxeo.agentic.signature.<id>.}, never from a document or a request, and logs none of them;</li>
 * <li>authenticates a callback before it reads anything of it but what the scheme needs, compares
 * a signature in constant time ({@link java.security.MessageDigest#isEqual}), and returns, as the
 * callback's time, one the signature covers;</li>
 * <li>bounds every call to its service: a connect timeout, a deadline, the bytes it reads, and no
 * redirect followed;</li>
 * <li>throws {@link SignatureProviderException} with a kind, never a message that quotes its
 * service's answer, which the add-on would otherwise show a user.</li>
 * </ul>
 */
public interface SignatureProvider {

    /** Given once, after the provider is made: its id and where its settings are read. */
    void init(String id, SignatureSettings settings);

    /** Whether the server has given it everything it needs to send, and to authenticate a callback. */
    boolean configured();

    /** The largest file it sends, in bytes. */
    default long maxBytes() {
        return 10L * 1024 * 1024;
    }

    /** The files it sends, by their type. */
    default List<String> accepts() {
        return List.of("application/pdf");
    }

    /**
     * Send a file to its signers. Returns the envelope's id at the provider, one path segment
     * ({@link Signatures#EXTERNAL_ID}), which its callbacks name.
     */
    String send(Envelope envelope);

    /**
     * Authenticate a callback, and read it once authenticated.
     *
     * @throws CallbackRefusedException when it is not the provider's, whatever is wrong with it
     */
    CallbackEvent authenticate(Callback callback);

    /** The signed file and the provider's evidence, for an envelope its service says is signed. */
    SignedResult fetchSigned(String envelope);

    /** Void an envelope at the provider, for a request cancelled or never saved. */
    void cancel(String envelope);
}
