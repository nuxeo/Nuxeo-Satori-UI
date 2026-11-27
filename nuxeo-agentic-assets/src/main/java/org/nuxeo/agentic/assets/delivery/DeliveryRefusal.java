/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.delivery;

import org.nuxeo.ecm.core.api.NuxeoException;

/**
 * A delivery refused: nothing of it is written. Its HTTP status is the REST API's answer; its code
 * names the refusal for a client and a test, the rights' own reason code when the rights refused
 * it, as a refused download's is; its message is one sentence that names no document the filer may
 * not read.
 */
public class DeliveryRefusal extends NuxeoException {

    private static final long serialVersionUID = 1L;

    private final String code;

    DeliveryRefusal(int status, String code, String message) {
        super(message, status);
        this.code = code;
    }

    /**
     * What was refused: a rights code such as {@code outside-window}, {@code territory-not-covered}
     * or {@code rights-ended}, or {@code version}, {@code request}, {@code server-only} or
     * {@code kept}.
     */
    public String getCode() {
        return code;
    }
}
