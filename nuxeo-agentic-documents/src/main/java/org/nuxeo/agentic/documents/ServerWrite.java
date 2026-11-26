/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

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

    /** The context data key the mark goes under. */
    static final String KEY = "org.nuxeo.agentic.documents.serverWrite";

    /** A recipient's receipt, created by the add-on when its transmittal is issued. */
    static final ServerWrite RECEIPT = new ServerWrite("a transmittal's receipt");

    /** A closed review cycle, recorded on the revision it reviewed. */
    static final ServerWrite REVIEW_RECORD = new ServerWrite("a review cycle's record");

    private final String what;

    private ServerWrite(String what) {
        this.what = what;
    }

    /** Mark the document's next write as {@code this}. */
    void mark(DocumentModel doc) {
        doc.putContextData(KEY, this);
    }

    /** Whether the document's write is marked {@code this}: the very object, not an equal one. */
    boolean marks(DocumentModel doc) {
        return doc.getContextData(KEY) == this;
    }

    @Override
    public String toString() {
        return what;
    }
}
