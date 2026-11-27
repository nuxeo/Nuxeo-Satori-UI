/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventBundle;
import org.nuxeo.ecm.core.event.PostCommitFilteringEventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.transaction.TransactionHelper;

/**
 * Captures each item received, in the background, once its creation has committed: so an upload
 * is never held up, or refused, by a provider that is slow or down. Each item as the system, in a
 * transaction of its own ({@link Capture#run}), under a claim of its capture; then, in another,
 * whatever happened, an item still received whose capture this run holds, or no one does, is set
 * to wait for a person, {@value Captures#NOT_FILED}: so no item is left received by a capture that
 * failed, threw or not. Nothing of a failure is logged but the item's id and its exception's type.
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
        String run = UUID.randomUUID().toString();
        try {
            Consumer<CoreSession> capture = session -> Capture.run(session, itemId, run);
            TransactionHelper.runInNewTransaction(() -> CoreInstance.doPrivileged(repository, capture));
        } catch (OutOfMemoryError | InternalError e) {
            throw e;
        } catch (Throwable e) { // NOSONAR: whatever failed, a stack overflow included, the item waits, below
            log.error("Capture: item {} could not be captured ({}), and waits for a person", itemId,
                    e.getClass().getSimpleName());
        }
        // Whatever happened, thrown or not: a transaction rolled back without a word, as one marked
        // for rollback by a provider or another listener is, leaves the item received. So an item
        // still received, whose capture this run holds or no one does, waits for a person.
        try {
            Consumer<CoreSession> fallback = session -> {
                if (Capture.receivedItem(session, itemId) == null || !claimForFallback(itemId, run)) {
                    return;
                }
                // Read again under the claim, and queue that: never a copy read before it.
                DocumentModel item = Capture.receivedItem(session, itemId);
                if (item != null) {
                    Capture.queue(session, item, Captures.NOT_FILED, null);
                }
            };
            TransactionHelper.runInNewTransaction(() -> CoreInstance.doPrivileged(repository, fallback));
        } catch (RuntimeException again) {
            log.error("Capture: item {} could not be set to wait for a person ({})", itemId,
                    again.getClass().getSimpleName());
        }
    }

    /**
     * The fallback's claim of the item's capture. When no claim can be taken at all, as when the
     * transaction gives no way to release one, the item waits for a person regardless: a capture
     * could not have taken one either, so none is under way.
     */
    private static boolean claimForFallback(String itemId, String run) {
        try {
            return Filing.claimCapture(itemId, run);
        } catch (NuxeoException e) {
            log.warn("Capture: item {}'s capture could not be claimed ({}); it waits for a person all the same",
                    itemId, e.getClass().getSimpleName());
            return true;
        }
    }
}
