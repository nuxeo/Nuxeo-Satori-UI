/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.util.ArrayList;
import java.util.List;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.assets.review.AuditAccess;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventBundle;
import org.nuxeo.ecm.core.event.PostCommitFilteringEventListener;
import org.nuxeo.ecm.platform.audit.api.AuditLogger;
import org.nuxeo.ecm.platform.audit.api.LogEntry;

/**
 * Writes the add-on's audit entries for a marked copy that could not be made ({@link WatermarkAudit})
 * to the platform's audit, once the job's transaction has committed, in the background, as the
 * review's entries are written, and for the same reason: the platform's own listener takes only the
 * events its configuration names.
 */
public class WatermarkAuditWriter implements PostCommitFilteringEventListener {

    private static final Logger log = LogManager.getLogger(WatermarkAuditWriter.class);

    /** This add-on's own entry: of its name, and carrying its mark, a boolean, which {@code Event.Fire} cannot set. */
    @Override
    public boolean acceptEvent(Event event) {
        return WatermarkAudit.EVENT.equals(event.getName()) && event.getContext() != null
                && Boolean.TRUE.equals(event.getContext().getProperty(WatermarkAudit.MARK));
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
            log.error("Asset rights: {} marked cop{} failure entr{} could not be written to the audit", entries.size(),
                    entries.size() == 1 ? "y's" : "ies'", entries.size() == 1 ? "y" : "ies", e);
            throw e;
        }
    }
}
