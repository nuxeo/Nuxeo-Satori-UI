package org.nuxeo.agentic.records;

import org.nuxeo.ecm.core.api.NuxeoException;

/**
 * A refusal: the change is not made, and nothing of it is written. Its HTTP status is the REST
 * API's answer; its code names the refusal for a client and a test; its message is one sentence
 * that names no record a person could not read.
 */
public class DispositionRefusal extends NuxeoException {

    private static final long serialVersionUID = 1L;

    private final String code;

    DispositionRefusal(int status, String code, String message) {
        super(message, status);
        this.code = code;
    }

    /** What was refused: {@code permission}, {@code self-approval}, {@code already-approved}, and so on. */
    public String getCode() {
        return code;
    }
}
