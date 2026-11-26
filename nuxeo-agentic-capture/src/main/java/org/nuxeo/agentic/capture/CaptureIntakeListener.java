/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentNotFoundException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventBundle;
import org.nuxeo.ecm.core.event.PostCommitFilteringEventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Captures each item received, in the background, once its creation has committed: so an upload
 * is never held up, or refused, by a provider that is slow or down. Each item as the system, in a
 * transaction of its own ({@link Capture#run}); one that fails is rolled back, and then, in another
 * transaction, set to wait for a person, {@value Captures#NOT_FILED}, so that no item is left
 * received for good. Nothing of the failure is logged but the item's id and its exception's type.
 */
public class CaptureIntakeListener implements PostCommitFilteringEventListener {

    private static final Logger log = LogManager.getLogger(CaptureIntakeListener.class);

    @Override
    public boolean acceptEvent(Event event) {
        return DocumentEventTypes.DOCUMENT_CREATED.equals(event.getName())
                && event.getContext() instanceof DocumentEventContext context
                && context.getSourceDocument() != null && context.getSourceDocument().hasFacet(Captures.FACET);
    }

    @Override
    public void handleEvent(EventBundle events) {
        Map<String, String> items = new LinkedHashMap<>();
        for (Event event : events) {
            if (acceptEvent(event)) {
                DocumentModel doc = ((DocumentEventContext) event.getContext()).getSourceDocument();
                items.put(doc.getId(), doc.getRepositoryName());
            }
        }
        items.forEach(this::capture);
    }

    private void capture(String itemId, String repository) {
        try {
            Consumer<CoreSession> run = session -> Capture.run(session, itemId);
            TransactionHelper.runInNewTransaction(() -> CoreInstance.doPrivileged(repository, run));
        } catch (RuntimeException e) {
            log.error("Capture: item {} could not be captured ({}), and waits for a person", itemId,
                    e.getClass().getSimpleName());
            try {
                TransactionHelper.runInNewTransaction(() -> CoreInstance.doPrivileged(repository, session -> {
                    DocumentModel item;
                    try {
                        item = session.getDocument(new IdRef(itemId));
                    } catch (DocumentNotFoundException gone) {
                        return;
                    }
                    if (Captures.RECEIVED.equals(Captures.text(item, Captures.STATUS))) {
                        Capture.queue(session, item, Captures.NOT_FILED, null);
                    }
                }));
            } catch (RuntimeException again) {
                log.error("Capture: item {} could not be set to wait for a person either ({})", itemId,
                        again.getClass().getSimpleName());
            }
        }
    }
}
