/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.io.Serializable;

import org.nuxeo.ecm.core.api.DocumentModel;

/**
 * The mark of one of the add-on's own writes of an item, in the item's context data, so that its
 * guards let that write through and nothing else: a client can put a text or a number in a
 * document's context data, never this object. Compared by identity, so a copy of it, a serialized
 * one among them, is never taken for it. The e-signature add-on's, as it is.
 */
final class ServerWrite implements Serializable {

    private static final long serialVersionUID = 1L;

    static final String KEY = "org.nuxeo.agentic.capture.serverWrite";

    /** An item's capt: properties, written by the server. */
    static final ServerWrite ITEM = new ServerWrite();

    private ServerWrite() {
    }

    void mark(DocumentModel doc) {
        doc.putContextData(KEY, this);
    }

    /**
     * Whether the document's write is marked, taking the mark off: a mark lets the one write
     * through, and not a later save of the same model.
     */
    boolean consumes(DocumentModel doc) {
        if (doc.getContextData(KEY) != this) {
            return false;
        }
        doc.getContextData().remove(KEY);
        return true;
    }
}
