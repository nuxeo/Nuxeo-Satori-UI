/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.nuxeo.agentic.documents.ControlledDocuments.STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDED;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDED_BY;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;

/**
 * For the atomicity test: fails the supersession's second write, the old revision marked
 * superseded, once its new revision exists in the transaction. Runs after the add-on's listener,
 * on {@code beforeDocumentModification}, and does nothing unless a test names the document.
 */
public class FailingWrite implements EventListener {

    static final String MESSAGE = "the old revision's write failed, on purpose";

    private static final AtomicReference<String> target = new AtomicReference<>();

    private static final AtomicBoolean sawRevision = new AtomicBoolean();

    static void failNext(String id) {
        sawRevision.set(false);
        target.set(id);
    }

    static void reset() {
        target.set(null);
    }

    /** Whether, when it failed the write, the new revision had been created in the transaction. */
    static boolean sawCreatedRevision() {
        return sawRevision.get();
    }

    @Override
    public void handleEvent(Event event) {
        if (!(event.getContext() instanceof DocumentEventContext context)) {
            return;
        }
        DocumentModel doc = context.getSourceDocument();
        String id = target.get();
        if (id == null || doc == null || !id.equals(doc.getId()) || !SUPERSEDED.equals(doc.getPropertyValue(STATUS))) {
            return;
        }
        String revision = (String) doc.getPropertyValue(SUPERSEDED_BY);
        sawRevision.set(revision != null && context.getCoreSession().exists(new IdRef(revision)));
        target.set(null);
        event.markBubbleException();
        throw new NuxeoException(MESSAGE);
    }
}
