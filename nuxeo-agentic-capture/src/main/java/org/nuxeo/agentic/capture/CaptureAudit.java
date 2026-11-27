/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.io.Serializable;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.nuxeo.common.utils.Path;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.event.EventService;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.ecm.core.event.impl.ShallowDocumentModel;
import org.nuxeo.runtime.api.Framework;

/**
 * What the add-on adds to the platform's audit: an item queued for a person, an item filed, on the
 * item and on its record, and an item rejected. Each fired in the transaction of what it records,
 * so a refused or failed one records nothing; {@link CaptureAuditWriter} writes them once that
 * transaction has committed. The platform builds each entry from its event: who, when, the
 * document, the comment, and the extended information below, which names the class, the
 * confidence, the outcome and the other document, and never a field's value or the file.
 */
final class CaptureAudit {

    static final String QUEUED = "captureQueued";

    static final String FILED = "captureFiled";

    static final String REJECTED = "captureRejected";

    static final Set<String> EVENTS = Set.of(QUEUED, FILED, REJECTED);

    static final String CATEGORY = "capture";

    // Extended information.
    static final String ITEM = "item";

    static final String RECORD = "record";

    static final String CLASS = "class";

    static final String CONFIDENCE = "confidence";

    static final String OUTCOME = "outcome";

    static final String REASON = "reason";

    static final String BY = "by";

    static final String PROFILE = "profile";

    static final String EXTENDED_INFOS = "extendedInfos";

    static final String SKIP_REFETCH = "skipRefetchDocument";

    private CaptureAudit() {
    }

    /** An item waiting for a person, and why. */
    static void queued(CoreSession session, DocumentModel item, String reason, String className, double confidence) {
        Map<String, Serializable> extended = base(item, className, confidence);
        extended.put(REASON, reason);
        extended.put(BY, Captures.SYSTEM);
        fire(session, null, item, QUEUED, "Waiting for a person: " + reason, extended);
    }

    /**
     * An item filed on its record: one entry on each. Each names the other by id only, and the
     * record's the file's name, which the record now shows anyway: neither the record's title on
     * the item's history, nor the item's on the record's.
     */
    static void filed(CoreSession session, NuxeoPrincipal by, DocumentModel item, DocumentModel record,
            String fileName, String className, double confidence, String outcome, String decidedBy) {
        Map<String, Serializable> extended = base(item, className, confidence);
        extended.put(RECORD, record.getId());
        extended.put(OUTCOME, outcome);
        extended.put(BY, decidedBy);
        String percent = String.format(Locale.ROOT, "%.0f%%", confidence * 100);
        String how = Captures.AUTOMATIC.equals(outcome) ? "automatically" : outcome + " by " + decidedBy;
        fire(session, by, item, FILED, "Filed on its record as " + className + ", " + percent + ", " + how, extended);
        fire(session, by, record, FILED, "Filed from the inbox: " + fileName + ", as " + className + ", " + percent
                + ", " + how, extended);
    }

    static void rejected(CoreSession session, NuxeoPrincipal by, DocumentModel item, String decidedBy) {
        Map<String, Serializable> extended = base(item, Captures.text(item, Captures.CLASS), 0);
        extended.remove(CONFIDENCE);
        extended.put(OUTCOME, Captures.REJECTED);
        extended.put(BY, decidedBy);
        fire(session, by, item, REJECTED, "Rejected by " + decidedBy, extended);
    }

    private static Map<String, Serializable> base(DocumentModel item, String className, double confidence) {
        Map<String, Serializable> extended = new HashMap<>();
        extended.put(ITEM, item.getId());
        String profile = Captures.text(item, Captures.PROFILE);
        if (profile != null) {
            extended.put(PROFILE, profile);
        }
        if (className != null) {
            extended.put(CLASS, className);
        }
        extended.put(CONFIDENCE, confidence);
        return extended;
    }

    private static void fire(CoreSession session, NuxeoPrincipal by, DocumentModel doc, String event, String comment,
            Map<String, Serializable> extended) {
        if (doc.getId() == null || doc.getPathAsString() == null) {
            return;
        }
        NuxeoPrincipal principal = by != null ? by : session.getPrincipal();
        DocumentEventContext context = new DocumentEventContext(session, principal, snapshot(doc));
        context.setProperty("category", CATEGORY);
        context.setProperty("comment", comment);
        context.setProperty(EXTENDED_INFOS, new HashMap<>(extended));
        Framework.getService(EventService.class).fireEvent(context.newEvent(event));
    }

    /** What the audit reads of a document, kept as it is now: never read again in the background. */
    private static ShallowDocumentModel snapshot(DocumentModel doc) {
        Map<String, Serializable> context = new HashMap<>();
        context.put(SKIP_REFETCH, Boolean.TRUE);
        Path where = new Path(doc.getPathAsString());
        Set<String> facets = new HashSet<>(doc.getFacets());
        return new ShallowDocumentModel(doc.getId(), doc.getRepositoryName(), where.lastSegment(), where,
                doc.getType(), doc.isFolder(), doc.isVersion(), doc.isProxy(), doc.isImmutable(), context, facets,
                doc.isLifeCycleLoaded() ? doc.getCurrentLifeCycleState() : null);
    }
}
