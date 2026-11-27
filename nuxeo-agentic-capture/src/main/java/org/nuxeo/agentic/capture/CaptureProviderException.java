/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

/**
 * A provider that could not answer, by its kind, whose message is the kind's one sentence: never
 * what a service said, which may quote the item, and never a setting.
 */
public class CaptureProviderException extends Exception {

    private static final long serialVersionUID = 1L;

    public enum Kind {
        /** What the provider calls is not there: an operation the server does not have. */
        UNAVAILABLE("The capture provider's service is not available"),
        /** It was there, and failed. */
        FAILED("The capture provider's service failed"),
        /** It answered something the add-on does not take. */
        UNREADABLE("The capture provider's answer could not be read");

        private final String sentence;

        Kind(String sentence) {
            this.sentence = sentence;
        }

        public String sentence() {
            return sentence;
        }
    }

    private final Kind kind;

    public CaptureProviderException(Kind kind) {
        super(kind.sentence());
        this.kind = kind;
    }

    public Kind kind() {
        return kind;
    }
}
