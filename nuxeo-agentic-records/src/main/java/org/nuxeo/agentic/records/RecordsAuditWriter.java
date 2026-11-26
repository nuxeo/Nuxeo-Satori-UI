package org.nuxeo.agentic.records;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventBundle;
import org.nuxeo.ecm.core.event.PostCommitFilteringEventListener;
import org.nuxeo.ecm.platform.audit.api.AuditLogger;
import org.nuxeo.ecm.platform.audit.api.LogEntry;

/**
 * Writes the add-on's audit entries ({@link RecordsAudit}) to the platform's audit, once the
 * transaction that fired them has committed, in the background: the platform builds each entry from
 * its event, as it builds its own, and the add-on adds them in one call per transaction.
 *
 * <p>
 * Not the platform's own listener: that one takes the events its configuration names, and the
 * configuration's extension point is not the same on every LTS 2025 server. Writing them here needs
 * none. A person's read is never refused because of this: should the audit refuse the entries, the
 * server's log says how many, and of which events.
 */
public class RecordsAuditWriter implements PostCommitFilteringEventListener {

    private static final Logger log = LogManager.getLogger(RecordsAuditWriter.class);

    @Override
    public boolean acceptEvent(Event event) {
        return RecordsAudit.EVENTS.contains(event.getName());
    }

    @Override
    public void handleEvent(EventBundle events) {
        AuditLogger logger = AuditAccess.logger();
        List<LogEntry> entries = new ArrayList<>();
        Set<String> names = new TreeSet<>();
        for (Event event : events) {
            if (!acceptEvent(event)) {
                continue;
            }
            LogEntry entry = logger.buildEntryFromEvent(event);
            if (entry != null) {
                entries.add(entry);
                names.add(event.getName());
            }
        }
        if (entries.isEmpty()) {
            return;
        }
        try {
            logger.addLogEntries(entries);
        } catch (RuntimeException e) {
            log.error("Records audit: {} entr{} of the add-on's could not be written to the audit ({})", entries.size(),
                    entries.size() == 1 ? "y" : "ies", names, e);
            throw e;
        }
    }
}
