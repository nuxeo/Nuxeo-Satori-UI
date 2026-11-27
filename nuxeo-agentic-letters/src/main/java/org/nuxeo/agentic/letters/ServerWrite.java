/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.letters;

import java.io.Serializable;

import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * The mark of one of the add-on's own writes of a letter, in the written document's context data,
 * so that its guard lets that write through and nothing else: a client can put a text or a number
 * in a document's context data, never one of these objects. Compared by identity, so a copy of one,
 * a serialized one among them, is never taken for it. The e-signature add-on's, as it is.
 */
final class ServerWrite implements Serializable {

    private static final long serialVersionUID = 1L;

    static final String KEY = "org.nuxeo.agentic.letters.serverWrite";

    /** A letter's creation, by Letter.Generate. */
    static final ServerWrite CREATE = new ServerWrite("a letter's creation");

    /** A letter's file and binding, written once it is rendered. */
    static final ServerWrite FILE = new ServerWrite("a letter's file");

    private final String what;

    private ServerWrite(String what) {
        this.what = what;
    }

    void mark(DocumentModel doc) {
        doc.putContextData(KEY, this);
    }

    /**
     * Whether the document's write is marked {@code this}, taking the mark off: a mark lets the one
     * write through, and not a later save of the same model.
     */
    boolean consumes(DocumentModel doc) {
        if (doc.getContextData(KEY) != this) {
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
