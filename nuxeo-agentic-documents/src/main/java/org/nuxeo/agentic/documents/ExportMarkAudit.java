/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import java.io.Serializable;
import java.util.HashMap;
import java.util.HashSet;
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
 * What the add-on adds to the platform's audit about export-control marks: one entry, event
 * {@value #EVENT}, each time a revision's mark is set, changed, removed, or carried to a new
 * revision, on that revision, in its history.
 *
 * <p>Fired in the transaction of the change it records, so that a refused or failed change records
 * nothing; {@link ExportMarkAuditWriter} writes it to the audit once that transaction has
 * committed, as the records add-on writes its own. The platform builds the entry from the event:
 * who, when, the revision's id, path and type, the comment, and the extended information below.
 */
final class ExportMarkAudit {

    /** The audit's event id. */
    static final String EVENT = "exportMarkChanged";

    /** The audit's category for it. */
    static final String CATEGORY = "documentControl";

    /** What happened: {@value #MARKED}, {@value #CHANGED}, {@value #REMOVED} or {@value #CARRIED}. */
    static final String CHANGE = "change";

    static final String MARKED = "marked";

    static final String CHANGED = "changed";

    static final String REMOVED = "removed";

    static final String CARRIED = "carried";

    /** The mark after the change: its classification, and its groups joined by commas. */
    static final String CLASSIFICATION = "classification";

    static final String GROUPS = "groups";

    /** The mark before it, for a change and a removal. */
    static final String PREVIOUS_CLASSIFICATION = "previousClassification";

    static final String PREVIOUS_GROUPS = "previousGroups";

    /** For a mark carried: the id of the revision superseded, whose mark it was. */
    static final String CARRIED_FROM = "carriedFrom";

    /** Who acted: the user, or the one a privileged session acted for. */
    static final String BY = "by";

    /** An event context's property the platform's audit reads its extended information from. */
    static final String EXTENDED_INFOS = "extendedInfos";

    /** A document's context data that keeps it as fired, rather than read again in the background. */
    static final String SKIP_REFETCH = "skipRefetchDocument";

    private ExportMarkAudit() {
    }

    /** The kind of change from one mark to the other, or {@code null} when neither is a mark. */
    static String change(ExportMarks.Mark before, ExportMarks.Mark after) {
        if (after.isMarked()) {
            return before.isMarked() ? CHANGED : MARKED;
        }
        return before.isMarked() ? REMOVED : null;
    }

    /**
     * Fire the entry for {@code doc}, which has its id and path, as {@code by}, in the current
     * transaction. {@code carriedFrom} is the superseded revision's id for a mark carried, else
     * {@code null}.
     */
    static void fire(CoreSession session, NuxeoPrincipal by, DocumentModel doc, String change,
            ExportMarks.Mark before, ExportMarks.Mark after, String carriedFrom) {
        if (change == null || doc.getId() == null || doc.getPathAsString() == null) {
            return;
        }
        Map<String, Serializable> extended = new HashMap<>();
        extended.put(CHANGE, change);
        if (after.isMarked()) {
            extended.put(CLASSIFICATION, after.classification());
            extended.put(GROUPS, String.join(",", after.groups()));
        }
        if (before.isMarked()) {
            extended.put(PREVIOUS_CLASSIFICATION, before.classification());
            extended.put(PREVIOUS_GROUPS, String.join(",", before.groups()));
        }
        if (carriedFrom != null) {
            extended.put(CARRIED_FROM, carriedFrom);
        }
        String acting = Refusal.actingUser(by, by == null ? "?" : by.getName());
        extended.put(BY, acting);
        DocumentEventContext context = new DocumentEventContext(session, by, snapshot(doc));
        context.setProperty("category", CATEGORY);
        context.setProperty("comment", comment(change, before, after));
        context.setProperty(EXTENDED_INFOS, new HashMap<>(extended));
        Framework.getService(EventService.class).fireEvent(context.newEvent(EVENT));
    }

    /** The entry's comment, in a few words: "Export-control mark EC-1, for a, changed to EC-2, for b". */
    static String comment(String change, ExportMarks.Mark before, ExportMarks.Mark after) {
        return switch (change) {
            case MARKED -> "Export-control mark set: " + after.describe();
            case CHANGED -> "Export-control mark changed from " + before.describe() + " to " + after.describe();
            case REMOVED -> "Export-control mark removed: " + before.describe();
            case CARRIED -> "Export-control mark carried from the revision superseded: " + after.describe();
            default -> change;
        };
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
