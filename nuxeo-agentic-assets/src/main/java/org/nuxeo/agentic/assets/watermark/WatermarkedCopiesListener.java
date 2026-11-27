/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.rights.AssetRightsService;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventBundle;
import org.nuxeo.ecm.core.event.PostCommitFilteringEventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.api.Framework;

/**
 * Drops a long video's marked copies when their source changes, since 0.6.0: after the commit of a
 * change to a document of a type a policy covers, each of its copies whose place now holds another
 * file, or that was kept under another watermark than its type's now; after its removal, every one.
 * In the background, with the system's rights.
 *
 * <p>Not what keeps a stale copy from being served: a copy is found by a key that names the file's
 * digest and the watermark, so a request for the file the document holds now never finds one made of
 * another. This removes what can no longer be found.
 */
public class WatermarkedCopiesListener implements PostCommitFilteringEventListener {

    private static final Logger log = LogManager.getLogger(WatermarkedCopiesListener.class);

    static final Set<String> EVENTS = Set.of(DocumentEventTypes.DOCUMENT_UPDATED, DocumentEventTypes.DOCUMENT_REMOVED,
            "documentRestored");

    @Override
    public boolean acceptEvent(Event event) {
        if (!EVENTS.contains(event.getName()) || !(event.getContext() instanceof DocumentEventContext context)) {
            return false;
        }
        DocumentModel doc = context.getSourceDocument();
        if (doc == null || WatermarkedCopies.TYPE.equals(doc.getType())) {
            return false;
        }
        AssetRightsService rights = Framework.getService(AssetRightsService.class);
        return rights != null && rights.policyFor(doc.getType()) != null;
    }

    @Override
    public void handleEvent(EventBundle events) {
        if (!(Framework.getService(MarkedVideos.class) instanceof MarkedVideosComponent videos)) {
            return;
        }
        // Each document once, removed if any of its events says so.
        Map<String, Boolean> sources = new LinkedHashMap<>();
        Map<String, String> repositories = new LinkedHashMap<>();
        for (Event event : events) {
            if (!acceptEvent(event)) {
                continue;
            }
            DocumentEventContext context = (DocumentEventContext) event.getContext();
            DocumentModel doc = context.getSourceDocument();
            String id = doc.getId();
            if (id == null) {
                continue;
            }
            boolean removed = DocumentEventTypes.DOCUMENT_REMOVED.equals(event.getName());
            sources.merge(id, removed, Boolean::logicalOr);
            repositories.putIfAbsent(id, context.getRepositoryName());
        }
        sources.forEach((id, removed) -> {
            try {
                int dropped = CoreInstance.doPrivileged(repositories.get(id),
                        (Function<CoreSession, Integer>) privileged -> videos.drop(privileged, id, removed));
                if (dropped > 0) {
                    log.info("Asset rights: dropped {} marked cop{} of {}, whose file or watermark changed", dropped,
                            dropped == 1 ? "y" : "ies", id);
                }
            } catch (RuntimeException e) {
                // Never served all the same: their key names the file and the watermark they were made of.
                log.error("Asset rights: the marked copies of {} could not be dropped", id, e);
            }
        });
    }
}
