/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import org.nuxeo.ecm.core.api.NuxeoException;

/**
 * A review decision refused: nothing of the request is written. Its HTTP status is the REST API's
 * answer; its code names the refusal for a client and a test; its message is one sentence a person
 * can act on, naming no document they may not read.
 */
public class ReviewRefusal extends NuxeoException {

    private static final long serialVersionUID = 1L;

    private final String code;

    ReviewRefusal(int status, String code, String message) {
        super(message, status);
        this.code = code;
    }

    /**
     * What was refused: {@code not-a-reviewer}, {@code not-reviewable}, {@code invalid},
     * {@code concluded}, {@code not-live}, {@code kept} or {@code server-only}.
     */
    public String getCode() {
        return code;
    }
}
