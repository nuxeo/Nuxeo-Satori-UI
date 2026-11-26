/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

/**
 * A call to a provider's service that did not succeed, by its kind only: its message is the kind's
 * sentence, never what the service said, its address or a credential.
 */
public class SignatureProviderException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /** What went wrong, each with the one sentence a user may be told. */
    public enum Kind {
        NOT_CONFIGURED("the server has not been given what the e-signature service needs"),
        UNREACHABLE("the e-signature service could not be reached"),
        TIMEOUT("the e-signature service did not answer in time"),
        REFUSED("the e-signature service refused the request"),
        NOT_FOUND("the e-signature service has no such envelope"),
        NOT_SIGNED("the e-signature service does not say the envelope is signed"),
        TOO_LARGE("the e-signature service's answer was larger than the server takes"),
        UNREADABLE("the e-signature service's answer could not be read");

        private final String sentence;

        Kind(String sentence) {
            this.sentence = sentence;
        }

        public String sentence() {
            return sentence;
        }
    }

    private final Kind kind;

    public SignatureProviderException(Kind kind) {
        super(kind.sentence());
        this.kind = kind;
    }

    public Kind kind() {
        return kind;
    }
}
