/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.assets.watermark;

import java.io.Serializable;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.nuxeo.agentic.assets.watermark.MarkedVideos.Job;
import org.nuxeo.common.utils.Path;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.impl.UserPrincipal;
import org.nuxeo.ecm.core.event.EventService;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.ecm.core.event.impl.ShallowDocumentModel;
import org.nuxeo.runtime.api.Framework;

/**
 * What the add-on adds to the platform's audit about a marked copy, since 0.6.0: one entry, event
 * {@value #EVENT}, when a job could not make one, on the document its file is of, in its history.
 *
 * <p>Fired in the job's transaction; {@link WatermarkAuditWriter} writes it once that transaction has
 * committed, as the review's entries are written. The entry names who asked, as its principal, and
 * the use, the reason, why it was marked and the job, as its extended information.
 */
final class WatermarkAudit {

    /** The audit's event id. */
    static final String EVENT = "assetWatermarkFailed";

    /** The audit's category for it. */
    static final String CATEGORY = "assetRights";

    static final String USE = "use";

    static final String REASON = "reason";

    static final String PURPOSE = "purpose";

    static final String FOR = "for";

    static final String JOB = "job";

    static final String EXTENDED_INFOS = "extendedInfos";

    static final String SKIP_REFETCH = "skipRefetchDocument";

    /**
     * The mark this add-on's own entry carries, a boolean: Automation's {@code Event.Fire}, which any
     * user may run, sets its event's properties as text only, so an event of this name it fires is
     * not written to the audit.
     */
    static final String MARK = "agenticAssetWatermarkFailure";

    private WatermarkAudit() {
    }

    /** Fire the entry for {@code job}'s failure, in the current transaction; nothing when its document is gone. */
    static void failed(CoreSession privileged, Job job, String reason) {
        IdRef ref = new IdRef(job.document());
        if (!privileged.exists(ref)) {
            return;
        }
        DocumentModel doc = privileged.getDocument(ref);
        Map<String, Serializable> extended = new HashMap<>();
        extended.put(USE, job.use());
        extended.put(REASON, reason);
        extended.put(PURPOSE, job.purpose());
        extended.put(FOR, job.recipient());
        extended.put(JOB, MarkedVideosComponent.brief(job.key()));
        String asker = job.user() == null || job.user().isBlank() ? "system" : job.user();
        DocumentEventContext context = new DocumentEventContext(privileged,
                new UserPrincipal(asker, List.of(), false, false), snapshot(doc));
        context.setProperty("category", CATEGORY);
        context.setProperty("comment", "The marked " + job.use() + " could not be made: " + reason);
        context.setProperty(EXTENDED_INFOS, new HashMap<>(extended));
        context.setProperty(MARK, Boolean.TRUE);
        Framework.getService(EventService.class).fireEvent(context.newEvent(EVENT));
    }

    /** What the audit reads of the document, kept as it is now: never read again in the background. */
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
