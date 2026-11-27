/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

import java.util.ArrayList;
import java.util.List;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventBundle;
import org.nuxeo.ecm.core.event.PostCommitFilteringEventListener;
import org.nuxeo.ecm.platform.audit.api.AuditLogger;
import org.nuxeo.ecm.platform.audit.api.LogEntry;

/**
 * Writes the add-on's audit entries for review decisions ({@link ReviewAudit}) to the platform's
 * audit, once the transaction that fired them has committed, in the background: the platform builds
 * each entry from its event, as it builds its own, and the add-on adds them in one call per
 * transaction.
 *
 * <p>Not the platform's own listener, which takes only the events its configuration names, and whose
 * configuration's extension point is not the same on every LTS 2025 server: the documents and records
 * add-ons write their entries the same way, for the same reason. Should the audit refuse them, the
 * server's log says how many.
 */
public class ReviewAuditWriter implements PostCommitFilteringEventListener {

    private static final Logger log = LogManager.getLogger(ReviewAuditWriter.class);

    /**
     * This add-on's own entry: of its name, and carrying its mark, a boolean, which an event fired
     * through Automation's {@code Event.Fire}, its properties text, cannot.
     */
    @Override
    public boolean acceptEvent(Event event) {
        return ReviewAudit.EVENT.equals(event.getName()) && event.getContext() != null
                && Boolean.TRUE.equals(event.getContext().getProperty(ReviewAudit.MARK));
    }

    @Override
    public void handleEvent(EventBundle events) {
        List<Event> accepted = new ArrayList<>();
        for (Event event : events) {
            if (acceptEvent(event)) {
                accepted.add(event);
            }
        }
        if (accepted.isEmpty()) {
            return;
        }
        AuditLogger logger = AuditAccess.logger();
        List<LogEntry> entries = new ArrayList<>();
        for (Event event : accepted) {
            LogEntry entry = logger.buildEntryFromEvent(event);
            if (entry != null) {
                entries.add(entry);
            }
        }
        if (entries.isEmpty()) {
            return;
        }
        try {
            logger.addLogEntries(entries);
        } catch (RuntimeException e) {
            log.error("Asset review: {} decision entr{} could not be written to the audit", entries.size(),
                    entries.size() == 1 ? "y" : "ies", e);
            throw e;
        }
    }
}
