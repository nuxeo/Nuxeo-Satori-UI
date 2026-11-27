/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.review;

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
 * What the add-on adds to the platform's audit about an asset's review: one entry, event
 * {@value #EVENT}, for each decision written, on the asset, in its history.
 *
 * <p>Fired in the transaction of the decision, so that a refused or failed one records nothing;
 * {@link ReviewAuditWriter} writes it to the audit once that transaction has committed, as the
 * documents and records add-ons write their own. The platform builds the entry from the event: who,
 * when, the asset's id, path and type, the comment, and the extended information below.
 */
final class ReviewAudit {

    /** The audit's event id. */
    static final String EVENT = "assetReviewDecided";

    /** The audit's category for it. */
    static final String CATEGORY = "assetReview";

    /** {@code sent-back}, {@code approved} or {@code rejected}. */
    static final String DECISION = "decision";

    /** The round the payload names. */
    static final String ROUND = "round";

    /** The annotation that holds the decision. */
    static final String ANNOTATION = "annotation";

    /** Who decided: the person, never the system acting for them. */
    static final String BY = "by";

    /** An event context's property the platform's audit reads its extended information from. */
    static final String EXTENDED_INFOS = "extendedInfos";

    /** A document's context data that keeps it as fired, rather than read again in the background. */
    static final String SKIP_REFETCH = "skipRefetchDocument";

    /**
     * The mark this add-on's own entry carries, a boolean: Automation's {@code Event.Fire}, which any
     * user may run, sets its event's properties as text only, so an event of this name it fires is
     * not written to the audit.
     */
    static final String MARK = "agenticAssetReviewDecision";

    private ReviewAudit() {
    }

    /** Fire the entry for a decision on {@code asset}, as {@code by}, in the current transaction. */
    static void fire(CoreSession session, NuxeoPrincipal by, DocumentModel asset, ReviewPayload payload,
            String annotation) {
        if (asset.getId() == null || asset.getPathAsString() == null) {
            throw new IllegalStateException("a review's decision on an asset with no id or path");
        }
        Map<String, Serializable> extended = new HashMap<>();
        extended.put(DECISION, payload.code());
        extended.put(ROUND, (long) payload.round());
        if (annotation != null) {
            extended.put(ANNOTATION, annotation);
        }
        String name = by == null ? "?" : by.getName();
        extended.put(BY, name);
        DocumentEventContext context = new DocumentEventContext(session, by, snapshot(asset));
        context.setProperty("category", CATEGORY);
        context.setProperty("comment", comment(payload));
        context.setProperty(EXTENDED_INFOS, new HashMap<>(extended));
        context.setProperty(MARK, Boolean.TRUE);
        Framework.getService(EventService.class).fireEvent(context.newEvent(EVENT));
    }

    /** The entry's comment, in a few words: "Review round 2: approved". */
    static String comment(ReviewPayload payload) {
        return switch (payload.kind()) {
        case ROUND_CLOSED -> "Review round " + payload.round() + ": sent back";
        case DECISION -> "Review round " + payload.round() + ": " + payload.decision().code();
        case PIN -> "Review round " + payload.round() + ": a pin";
        };
    }

    /** What the audit reads of the asset, kept as it is now: never read again in the background. */
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
