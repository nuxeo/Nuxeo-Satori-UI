/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.signature;

import java.io.Serializable;

import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * The mark of one of the add-on's own writes, in the written document's context data, so that its
 * guards let that write through and nothing else: a client can put a text or a number in a
 * document's context data, never one of these objects. Compared by identity, so a copy of one,
 * a serialized one among them, is never taken for it.
 */
final class ServerWrite implements Serializable {

    private static final long serialVersionUID = 1L;

    static final String KEY = "org.nuxeo.agentic.signature.serverWrite";

    /** A record's sgn: properties, and its signed file. */
    static final ServerWrite RECORD = new ServerWrite("a record's signature");

    /** A request's ending: signed, declined or cancelled. */
    static final ServerWrite REQUEST = new ServerWrite("a request's ending");

    private final String what;

    private ServerWrite(String what) {
        this.what = what;
    }

    void mark(DocumentModel doc) {
        doc.putContextData(KEY, this);
    }

    boolean marks(DocumentModel doc) {
        return doc.getContextData(KEY) == this;
    }

    /**
     * Whether the document's write is marked {@code this}, taking the mark off: a mark lets the one
     * write through, and not a later save of the same model, such as the copy that
     * {@code session.copy} returns once the listener has written it.
     */
    boolean consumes(DocumentModel doc) {
        if (!marks(doc)) {
            return false;
        }
        doc.getContextData().remove(KEY);
        return true;
    }

    @Override
    public String toString() {
        return what;
    }
}
