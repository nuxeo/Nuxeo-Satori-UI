/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

/**
 * A callback that is not the provider's. The caller is told only that it was refused; the reason
 * is for the log, and names no value of the callback.
 */
public class CallbackRefusedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /** Why, for the log. */
    public enum Reason {
        /** The server has no secret to check it with. */
        NOT_CONFIGURED,
        /** No signature, or not in the scheme's form. */
        MISSING,
        /** A signature that does not match the body and its time. */
        MISMATCH,
        /** Authenticated, but not a callback the provider sends. */
        MALFORMED
    }

    private final Reason reason;

    public CallbackRefusedException(Reason reason) {
        super("The callback was refused (" + reason + ")");
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
