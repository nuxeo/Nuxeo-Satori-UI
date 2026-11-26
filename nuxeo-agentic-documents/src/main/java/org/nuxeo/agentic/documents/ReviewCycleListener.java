/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.nuxeo.agentic.documents.ControlledDocuments.CLOSED;
import static org.nuxeo.agentic.documents.ControlledDocuments.COMMENT_FACET;
import static org.nuxeo.agentic.documents.ControlledDocuments.COMMENT_PROPERTIES;
import static org.nuxeo.agentic.documents.ControlledDocuments.COMMENT_SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.CURRENT;
import static org.nuxeo.agentic.documents.ControlledDocuments.CYCLE_FACET;
import static org.nuxeo.agentic.documents.ControlledDocuments.CYCLE_PROPERTIES;
import static org.nuxeo.agentic.documents.ControlledDocuments.CYCLE_SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.FACET;
import static org.nuxeo.agentic.documents.ControlledDocuments.NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.NUXEO_COMMENT_SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.OPEN;
import static org.nuxeo.agentic.documents.ControlledDocuments.RESOLVED;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVIEW_CYCLES;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVIEW_SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVISION;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVWC_CYCLE;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVWC_RESOLUTION;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVWC_RESOLVED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVWC_RESOLVED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVWC_STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_CLOSED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_CLOSED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_COMMENTS;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_DOCUMENT;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_DUE_DATE;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_OPENED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_OPENED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_REVIEWERS;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_REVISION;
import static org.nuxeo.agentic.documents.ControlledDocuments.RVW_STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.isDocumentId;
import static org.nuxeo.agentic.documents.ControlledDocuments.isLive;
import static org.nuxeo.agentic.documents.ControlledDocuments.isUserName;
import static org.nuxeo.agentic.documents.Refusal.conflict;
import static org.nuxeo.agentic.documents.Refusal.forbidden;
import static org.nuxeo.agentic.documents.Refusal.invalid;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.TimeZone;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentNotFoundException;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.event.CoreEventConstants;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.api.Framework;

/**
 * Review cycles: a controlled document's revision reviewed in Nuxeo's own comments, each thread
 * open until the cycle's opener resolves it, and the cycle closed only with none open, which is
 * then recorded on the revision.
 *
 * <p>Synchronous, in the transaction of the change that fires it, as the user who makes it, or the
 * one a privileged session acts for, as Nuxeo's comment manager opens one to write a comment.
 * Every refusal marks that transaction for rollback.
 *
 * <ul>
 * <li><strong>A cycle's {@code aboutToCreate}:</strong> it opens on a current revision the opener
 * may write, with reviewers; then, created, it claims the revision, and is refused while another
 * cycle is open on it.</li>
 * <li><strong>A comment's {@code aboutToCreate}:</strong> a comment whose thread is a cycle's, by a
 * reviewer or the opener, while the cycle is open, is given the {@value ControlledDocuments#COMMENT_FACET}
 * facet, and its thread's first comment is {@value ControlledDocuments#OPEN}. Anyone else's is
 * refused, and every one once the cycle closes.</li>
 * <li><strong>A comment's {@code beforeDocumentModification}:</strong> the opener resolves a
 * thread, or opens it again, while the cycle is open; the server writes who and when. Nothing of
 * a closed cycle's comments changes.</li>
 * <li><strong>A cycle's {@code beforeDocumentModification}:</strong> its opener closes it, and only
 * with no thread open; the server writes who, when and how many, and adds the cycle to the
 * revision's {@value ControlledDocuments#REVIEW_CYCLES}, as the opener. Nothing else changes.</li>
 * <li><strong>{@code aboutToRemove} and {@code documentTrashed}:</strong> a cycle is kept, and so
 * are a closed cycle's comments; only an administrator deletes or trashes one.</li>
 * </ul>
 *
 * <p>A comment and a close cannot cross: each comment written in a cycle, and each change to one,
 * enters the cycle's fence for its transaction, and a close takes the fence only when no one is
 * in it ({@link ControlledDocumentService#closeCycle}).
 */
public class ReviewCycleListener implements EventListener {

    private static final Logger log = LogManager.getLogger(ReviewCycleListener.class);

    static final int MAX_REVIEWERS = 50;

    static final int MAX_RESOLUTION = 2000;

    /** Nuxeo's properties of a comment that say who wrote it and what it answers. */
    static final List<String> COMMENT_WRITTEN = List.of("comment:author", "comment:parentId", "comment:ancestorIds");

    private static final long DAY = 24L * 60 * 60 * 1000;

    static String openKey(String revisionId) {
        return "review." + revisionId;
    }

    @Override
    public void handleEvent(Event event) {
        if (!(event.getContext() instanceof DocumentEventContext context)) {
            return;
        }
        DocumentModel doc = context.getSourceDocument();
        if (doc == null) {
            return;
        }
        try {
            switch (event.getName()) {
                case DocumentEventTypes.ABOUT_TO_CREATE -> aboutToCreate(context, doc);
                case DocumentEventTypes.DOCUMENT_CREATED -> documentCreated(context, doc);
                case DocumentEventTypes.BEFORE_DOC_UPDATE -> beforeModification(context, doc);
                case DocumentEventTypes.ABOUT_TO_REMOVE, "documentTrashed" -> kept(context, doc, event.getName());
                case DocumentEventTypes.ABOUT_TO_MOVE -> aboutToMove(context, doc);
                default -> {
                    // Not one of ours: the contribution lists the six above.
                }
            }
        } catch (NuxeoException e) {
            throw refuse(event, context, doc, e);
        } catch (RuntimeException e) {
            throw refuse(event, context, doc, new NuxeoException("Review cycles: the change could not be checked, "
                    + "and is refused", e));
        }
    }

    // ------------------------------------------------------------------ opening

    private void aboutToCreate(DocumentEventContext context, DocumentModel doc) {
        if (doc.hasFacet(CYCLE_FACET)) {
            if (!doc.getDocumentType().hasFacet(CYCLE_FACET)) {
                throw invalid("The " + CYCLE_FACET + " facet comes with a document's type: it is not added to a "
                        + "document");
            }
            if (isLive(doc, CYCLE_FACET)) {
                open(context, doc);
            }
            return;
        }
        if (doc.hasSchema(NUXEO_COMMENT_SCHEMA) && !doc.isProxy() && !doc.isVersion()) {
            commentWritten(context, doc);
        } else if (doc.hasFacet(COMMENT_FACET)) {
            throw invalid("The " + COMMENT_FACET + " facet is the server's, on a review cycle's comments");
        }
    }

    private void open(DocumentEventContext context, DocumentModel doc) {
        CoreSession session = context.getCoreSession();
        String id = Stored.text(doc, CYCLE_SCHEMA, RVW_DOCUMENT);
        if (!isDocumentId(id)) {
            throw invalid("A review cycle names the revision it reviews by its id, in " + RVW_DOCUMENT);
        }
        DocumentModel revision;
        try {
            revision = session.getDocument(new IdRef(id));
        } catch (DocumentNotFoundException e) {
            throw invalid("No document has the id " + id);
        } catch (DocumentSecurityException e) {
            throw forbidden("You may not read the document " + id);
        }
        if (!isLive(revision, FACET)) {
            throw invalid("The document " + id + " is not a live controlled document");
        }
        if (revision.isTrashed()) {
            throw conflict("The revision " + id + " is in the trash");
        }
        if (!CURRENT.equals(Stored.text(revision, SCHEMA, STATUS))) {
            throw conflict("The revision " + id + " is superseded: a review cycle reviews a current revision");
        }
        if (!session.hasPermission(revision.getRef(), SecurityConstants.WRITE)) {
            throw forbidden("A review cycle is opened by someone who may write the revision it reviews, since it "
                    + "is recorded on it when it closes");
        }
        List<String> reviewers = List.copyOf(new LinkedHashSet<>(Stored.texts(doc, CYCLE_SCHEMA, RVW_REVIEWERS)));
        if (reviewers.isEmpty() || reviewers.size() > MAX_REVIEWERS) {
            throw invalid("A review cycle has 1 to " + MAX_REVIEWERS + " reviewers, by user name, in "
                    + RVW_REVIEWERS);
        }
        for (String reviewer : reviewers) {
            if (!isUserName(reviewer)) {
                throw invalid("A reviewer is a user name: letters, digits and @ . _ + -");
            }
        }
        Serializable due = doc.getPropertyValue(RVW_DUE_DATE);
        if (due instanceof Calendar day && day.getTimeInMillis() < TransmittalListener.startOfToday() - DAY) {
            throw invalid("A review cycle's due day is today or later");
        }
        String user = Refusal.actingUser(context.getPrincipal(), null);
        if (ControlledDocuments.text(doc, "dc:title") == null) {
            doc.setPropertyValue("dc:title", "Review of " + Stored.text(revision, SCHEMA, NUMBER) + " revision "
                    + Stored.text(revision, SCHEMA, REVISION));
        }
        doc.setPropertyValue(RVW_DOCUMENT, revision.getId());
        doc.setPropertyValue(RVW_NUMBER, Stored.text(revision, SCHEMA, NUMBER));
        doc.setPropertyValue(RVW_REVISION, Stored.text(revision, SCHEMA, REVISION));
        doc.setPropertyValue(RVW_REVIEWERS, (Serializable) reviewers);
        doc.setPropertyValue(RVW_STATUS, OPEN);
        doc.setPropertyValue(RVW_OPENED_BY, user);
        doc.setPropertyValue(RVW_OPENED_AT, now());
        doc.setPropertyValue(RVW_CLOSED_BY, null);
        doc.setPropertyValue(RVW_CLOSED_AT, null);
        doc.setPropertyValue(RVW_COMMENTS, null);
    }

    private void documentCreated(DocumentEventContext context, DocumentModel doc) {
        if (!isLive(doc, CYCLE_FACET)) {
            return;
        }
        String revision = Stored.text(doc, CYCLE_SCHEMA, RVW_DOCUMENT);
        // Two cycles opened at once would each find none open: one claim per revision lets one
        // through, and the query finds a cycle opened before the claim's time.
        if (!service().claim(openKey(revision), doc.getId())) {
            throw conflict("A review cycle is open on this revision, or being opened: one at a time");
        }
        String query = "SELECT ecm:uuid FROM Document WHERE ecm:mixinType = '" + CYCLE_FACET + "' AND "
                + RVW_DOCUMENT + " = '" + revision + "' AND " + RVW_STATUS + " = '" + OPEN + "' AND ecm:uuid <> '"
                + doc.getId() + "' AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0";
        boolean another = CoreInstance.doPrivileged(context.getCoreSession(),
                (CoreSession privileged) -> !privileged.queryProjection(query, 1, 0).isEmpty());
        if (another) {
            throw conflict("A review cycle is open on this revision already: close it first");
        }
    }

    // ------------------------------------------------------------------ comments

    /**
     * A new Nuxeo comment: in a cycle when its thread is the cycle's, which its ancestors say, as
     * Nuxeo's comment manager writes them before the comment exists.
     */
    private void commentWritten(DocumentEventContext context, DocumentModel comment) {
        CoreSession session = context.getCoreSession();
        Place place = placeOf(session, comment.getParentRef());
        if (place == null) {
            if (comment.hasFacet(COMMENT_FACET)) {
                throw invalid("The " + COMMENT_FACET + " facet is the server's, on a review cycle's comments");
            }
            // Written outside every cycle, it may not say it is in one: a cycle's comments are
            // the comments below it, whatever a comment's own properties say.
            refuseNamingACycle(session, comment);
            return;
        }
        String cycleId = place.cycle();
        if (!service().enterCycle(cycleId)) {
            throw conflict("This review cycle is closed, or being closed: it takes no more comments");
        }
        DocumentModel cycle = privileged(session, cycleId);
        if (cycle == null || !OPEN.equals(Stored.text(cycle, CYCLE_SCHEMA, RVW_STATUS))) {
            throw conflict("This review cycle is closed: it takes no more comments");
        }
        String user = Refusal.actingUser(context.getPrincipal(), null);
        if (!isReviewerOrOpener(cycle, user)) {
            throw forbidden("Only the review cycle's reviewers, and whoever opened it, comment in it");
        }
        if (!comment.hasFacet(COMMENT_FACET)) {
            comment.addFacet(COMMENT_FACET);
        }
        // Where it is says what it answers, and who acts says who wrote it, whatever was sent.
        comment.setPropertyValue("comment:author", user);
        comment.setPropertyValue("comment:parentId", place.parent());
        comment.setPropertyValue("comment:ancestorIds", (Serializable) place.ancestors());
        comment.setPropertyValue(RVWC_CYCLE, cycleId);
        comment.setPropertyValue(RVWC_STATUS, place.thread() ? OPEN : null);
        comment.setPropertyValue(RVWC_RESOLUTION, null);
        comment.setPropertyValue(RVWC_RESOLVED_BY, null);
        comment.setPropertyValue(RVWC_RESOLVED_AT, null);
    }

    /** The most ancestors a comment outside every cycle may name, each read to check it. */
    static final int MAX_ANCESTORS = 16;

    /**
     * A comment outside every cycle that names a cycle, or one of its comments, as what it answers
     * or among its ancestors, as Nuxeo's comment queries read them, is refused.
     */
    private static void refuseNamingACycle(CoreSession session, DocumentModel comment) {
        List<String> named = new ArrayList<>();
        String parentId = ControlledDocuments.text(comment, "comment:parentId");
        if (parentId != null) {
            named.add(parentId);
        }
        named.addAll(Stored.texts(comment, NUXEO_COMMENT_SCHEMA, "comment:ancestorIds"));
        if (named.size() > MAX_ANCESTORS + 1) {
            throw invalid("A comment names " + MAX_ANCESTORS + " ancestors at most");
        }
        for (String id : new LinkedHashSet<>(named)) {
            DocumentModel doc = isDocumentId(id) ? privileged(session, id) : null;
            if (doc != null && (doc.hasFacet(CYCLE_FACET) || doc.hasFacet(COMMENT_FACET))) {
                throw invalid("A comment in a review cycle is written below the cycle, where its comments are");
            }
        }
    }

    /**
     * Where a comment is written in a cycle: the cycle, what it answers, the cycle itself or a
     * comment, its ancestors as Nuxeo lists them, nearest first, and whether it opens a thread.
     */
    private record Place(String cycle, String parent, List<String> ancestors, boolean thread) {
    }

    /**
     * The cycle a document below {@code parentRef} is in, read from where it is, with a privileged
     * session, never from what the document says: the nearest of its folders that is a live cycle,
     * or a comment in one. {@code null} outside every cycle. A comment below a cycle's proxy or
     * version is refused: a cycle's comments are on the cycle.
     */
    private static Place placeOf(CoreSession session, org.nuxeo.ecm.core.api.DocumentRef parentRef) {
        if (parentRef == null) {
            return null;
        }
        List<DocumentModel> chain = CoreInstance.doPrivileged(session,
                (CoreSession s) -> s.exists(parentRef) ? s.getParentDocuments(parentRef) : List.<DocumentModel> of());
        // The chain runs from the root down to the parent: the nearest cycle is the last one in it.
        for (int i = chain.size() - 1; i >= 0; i--) {
            DocumentModel doc = chain.get(i);
            if (!doc.hasFacet(CYCLE_FACET)) {
                continue;
            }
            if (!isLive(doc, CYCLE_FACET)) {
                throw invalid("A review cycle's comments are written on the cycle, not on a proxy or a version");
            }
            // What it answers is its nearest comment below the cycle, or the cycle; its ancestors,
            // each comment it answers up to the cycle, nearest first, then the cycle, as Nuxeo's
            // comment manager writes them.
            List<String> ancestors = new ArrayList<>();
            for (int j = chain.size() - 1; j > i; j--) {
                if (chain.get(j).hasSchema(NUXEO_COMMENT_SCHEMA)) {
                    ancestors.add(chain.get(j).getId());
                }
            }
            ancestors.add(doc.getId());
            return new Place(doc.getId(), ancestors.get(0), List.copyOf(ancestors), ancestors.size() == 1);
        }
        return null;
    }

    private void beforeModification(DocumentEventContext context, DocumentModel doc) {
        DocumentModel previous = context.getProperty(CoreEventConstants.PREVIOUS_DOCUMENT_MODEL) instanceof DocumentModel p
                ? p
                : context.getCoreSession().getDocument(doc.getRef());
        if (previous.hasFacet(CYCLE_FACET) != doc.hasFacet(CYCLE_FACET)) {
            throw invalid("The " + CYCLE_FACET + " facet comes with a document's type: it is not added to a document "
                    + "or removed from one");
        }
        if (previous.hasFacet(COMMENT_FACET) != doc.hasFacet(COMMENT_FACET)) {
            throw invalid("The " + COMMENT_FACET + " facet is the server's, on a review cycle's comments");
        }
        if (doc.hasFacet(CYCLE_FACET)) {
            cycleChanged(context, previous, doc);
        } else if (doc.hasFacet(COMMENT_FACET)) {
            commentChanged(context, previous, doc);
        } else if (doc.hasSchema(NUXEO_COMMENT_SCHEMA)
                && !Stored.changes(previous, doc, NUXEO_COMMENT_SCHEMA, COMMENT_WRITTEN).isEmpty()) {
            // A comment outside every cycle comes to say it is in one no more than when written.
            refuseNamingACycle(context.getCoreSession(), doc);
        }
    }

    /**
     * A comment of a cycle's, changed: the opener's resolution of a thread, or its text, by
     * whoever Nuxeo lets, while the cycle is open. Nothing once it is closed.
     */
    private void commentChanged(DocumentEventContext context, DocumentModel previous, DocumentModel doc) {
        List<String> ours = Stored.changes(previous, doc, COMMENT_SCHEMA, COMMENT_PROPERTIES);
        if (ours.isEmpty() && !doc.isDirty()) {
            return;
        }
        CoreSession session = context.getCoreSession();
        String cycleId = Stored.text(previous, COMMENT_SCHEMA, RVWC_CYCLE);
        if (cycleId == null || !service().enterCycle(cycleId)) {
            throw conflict("This review cycle is closed, or being closed: its comments are kept as they were");
        }
        DocumentModel cycle = privileged(session, cycleId);
        if (cycle == null || !OPEN.equals(Stored.text(cycle, CYCLE_SCHEMA, RVW_STATUS))) {
            throw conflict("This review cycle is closed: its comments are kept as they were");
        }
        // Who wrote it and what it answers are where and by whom it was written: never changed.
        List<String> written = Stored.changes(previous, doc, NUXEO_COMMENT_SCHEMA, COMMENT_WRITTEN);
        if (!written.isEmpty()) {
            throw invalid(String.join(", ", written) + (written.size() == 1 ? " is" : " are")
                    + " where and by whom the comment was written, and not changed");
        }
        String user = Refusal.actingUser(context.getPrincipal(), null);
        // Its words are its author's, as Nuxeo's comment endpoint holds them: not anyone's who
        // may write the comment as a document.
        if (!Stored.changes(previous, doc, NUXEO_COMMENT_SCHEMA, List.of("comment:text")).isEmpty()
                && !Objects.equals(user, Stored.text(previous, NUXEO_COMMENT_SCHEMA, "comment:author"))) {
            throw forbidden("Only its author changes what a review cycle's comment says");
        }
        if (ours.isEmpty()) {
            return;
        }
        if (!isLive(doc, COMMENT_FACET)) {
            throw invalid("A comment is resolved on itself, not through a proxy or a version");
        }
        List<String> others = ours.stream().filter(p -> !p.equals(RVWC_STATUS) && !p.equals(RVWC_RESOLUTION)).toList();
        if (!others.isEmpty()) {
            throw invalid(String.join(", ", others) + (others.size() == 1 ? " is" : " are")
                    + " given by the server, and not changed");
        }
        if (Stored.text(previous, COMMENT_SCHEMA, RVWC_STATUS) == null) {
            throw invalid("A reply is not resolved: its thread's first comment is");
        }
        String opener = Stored.text(cycle, CYCLE_SCHEMA, RVW_OPENED_BY);
        if (opener == null || !opener.equals(user)) {
            throw forbidden("Only whoever opened this review cycle, " + opener + ", resolves its comments");
        }
        String status = Stored.text(doc, COMMENT_SCHEMA, RVWC_STATUS);
        if (!OPEN.equals(status) && !RESOLVED.equals(status)) {
            throw invalid(RVWC_STATUS + " is " + OPEN + " or " + RESOLVED);
        }
        String resolution = Stored.text(doc, COMMENT_SCHEMA, RVWC_RESOLUTION);
        if (resolution != null && resolution.length() > MAX_RESOLUTION) {
            throw invalid("A resolution is " + MAX_RESOLUTION + " characters at most");
        }
        doc.setPropertyValue(RVWC_STATUS, status);
        doc.setPropertyValue(RVWC_RESOLUTION, resolution);
        boolean resolved = RESOLVED.equals(status);
        doc.setPropertyValue(RVWC_RESOLVED_BY, resolved ? user : null);
        doc.setPropertyValue(RVWC_RESOLVED_AT, resolved ? now() : null);
    }

    // ------------------------------------------------------------------ closing

    private void cycleChanged(DocumentEventContext context, DocumentModel previous, DocumentModel doc) {
        List<String> changed = Stored.changes(previous, doc, CYCLE_SCHEMA, CYCLE_PROPERTIES);
        if (changed.isEmpty()) {
            return;
        }
        if (!isLive(doc, CYCLE_FACET)) {
            throw invalid("A review cycle is closed on itself, not through a proxy or a version");
        }
        if (!OPEN.equals(Stored.text(previous, CYCLE_SCHEMA, RVW_STATUS))) {
            throw conflict("A closed review cycle is not changed");
        }
        if (!changed.equals(List.of(RVW_STATUS))) {
            List<String> others = changed.stream().filter(p -> !p.equals(RVW_STATUS)).toList();
            throw invalid(String.join(", ", others) + (others.size() == 1 ? " is" : " are")
                    + " given when the cycle opens, and not changed");
        }
        if (!CLOSED.equals(Stored.text(doc, CYCLE_SCHEMA, RVW_STATUS))) {
            throw invalid("A review cycle's " + RVW_STATUS + " goes from " + OPEN + " to " + CLOSED + ", and nowhere "
                    + "else");
        }
        String user = Refusal.actingUser(context.getPrincipal(), null);
        String opener = Stored.text(previous, CYCLE_SCHEMA, RVW_OPENED_BY);
        if (opener == null || !opener.equals(user)) {
            throw forbidden("Only whoever opened this review cycle, " + opener + ", closes it");
        }
        CoreSession session = context.getCoreSession();
        String id = doc.getId();
        if (!service().closeCycle(id)) {
            throw conflict("A comment is being written in this review cycle at this moment: close it again");
        }
        // The fence is held: no comment is written, or reopened, until this transaction ends.
        long open = count(session, id, "AND " + RVWC_STATUS + " = '" + OPEN + "'");
        if (open > 0) {
            throw conflict(open + (open == 1 ? " comment" : " comments") + " of this review cycle "
                    + (open == 1 ? "is" : "are") + " open: resolve each before closing it");
        }
        long threads = count(session, id, "AND " + RVWC_STATUS + " IS NOT NULL");
        Calendar now = now();
        doc.setPropertyValue(RVW_STATUS, CLOSED);
        doc.setPropertyValue(RVW_CLOSED_BY, user);
        doc.setPropertyValue(RVW_CLOSED_AT, now);
        doc.setPropertyValue(RVW_COMMENTS, threads);
        record(session, previous, id, user, now, threads);
    }

    /**
     * The closed cycle, added to the revision's record, as the opener: the platform checks their
     * right to write it again, and the revision's guard lets this one entry through.
     */
    private static void record(CoreSession session, DocumentModel cycle, String id, String user, Calendar at,
            long threads) {
        String revisionId = Stored.text(cycle, CYCLE_SCHEMA, RVW_DOCUMENT);
        DocumentModel revision;
        try {
            revision = session.getDocument(new IdRef(revisionId));
        } catch (DocumentNotFoundException e) {
            throw conflict("The revision this cycle reviewed, " + revisionId + ", no longer exists");
        } catch (DocumentSecurityException e) {
            throw forbidden("You may no longer read the revision this cycle reviewed, " + revisionId);
        }
        if (!revision.hasSchema(REVIEW_SCHEMA)) {
            throw conflict("The revision this cycle reviewed, " + revisionId + ", cannot record it");
        }
        List<Map<String, Serializable>> entries = new ArrayList<>(
                Stored.entries(revision, REVIEW_SCHEMA, REVIEW_CYCLES));
        Map<String, Serializable> entry = new HashMap<>();
        entry.put("cycle", id);
        entry.put("closedBy", user);
        entry.put("closedAt", at);
        entry.put("comments", threads);
        entries.add(entry);
        revision.setPropertyValue(REVIEW_CYCLES, (Serializable) entries);
        ServerWrite.REVIEW_RECORD.mark(revision);
        session.saveDocument(revision);
        // A new cycle may be opened on the revision once this one's close has committed.
        service().releaseOnCommit(openKey(revisionId), id);
    }

    /** How many threads of the cycle hold to {@code where}, counted with a privileged session. */
    private static long count(CoreSession session, String cycleId, String where) {
        String query = "SELECT ecm:uuid FROM Document WHERE ecm:mixinType = '" + COMMENT_FACET + "' AND " + RVWC_CYCLE
                + " = '" + cycleId + "' " + where + " AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0";
        return CoreInstance.doPrivileged(session,
                (CoreSession privileged) -> (long) privileged.queryProjection(query, 0, 0).size());
    }

    // ------------------------------------------------------------------ keeping

    /**
     * A cycle is kept, and so are its comments: an administrator deletes or trashes one; while the
     * cycle is open, a comment's author may too, a thread no one has answered yet, since its
     * replies would go with it. Proxies and versions are not the record.
     */
    private void kept(DocumentEventContext context, DocumentModel doc, String event) {
        if (doc.isProxy() || doc.isVersion()) {
            return;
        }
        NuxeoPrincipal principal = context.getPrincipal();
        if (doc.hasFacet(CYCLE_FACET)) {
            if (!Refusal.isAdministrator(principal)) {
                throw forbidden("A review cycle is kept: only an administrator deletes or trashes one");
            }
            log.warn("Review cycles: {} deletes or trashes the review cycle {}", principal.getName(), doc.getId());
            // An open cycle deleted leaves its revision free for another, once this commits. Not
            // one trashed, which may come back open: the trash is not the end of a cycle.
            String revision = Stored.text(doc, CYCLE_SCHEMA, RVW_DOCUMENT);
            if (revision != null && DocumentEventTypes.ABOUT_TO_REMOVE.equals(event)) {
                service().releaseOnCommit(openKey(revision), doc.getId());
            }
            return;
        }
        if (!doc.hasFacet(COMMENT_FACET) || Refusal.isAdministrator(principal)) {
            return;
        }
        String cycleId = Stored.text(doc, COMMENT_SCHEMA, RVWC_CYCLE);
        if (cycleId == null || !service().enterCycle(cycleId)) {
            throw conflict("This review cycle is closed, or being closed: its comments are kept");
        }
        DocumentModel cycle = privileged(context.getCoreSession(), cycleId);
        if (cycle != null && !OPEN.equals(Stored.text(cycle, CYCLE_SCHEMA, RVW_STATUS))) {
            throw conflict("This review cycle is closed: its comments are kept");
        }
        // Not the opener's, deleting a thread rather than resolving it: the author's own alone.
        if (!Objects.equals(Refusal.actingUser(principal, null), Stored.text(doc, NUXEO_COMMENT_SCHEMA,
                "comment:author"))) {
            throw forbidden("Only its author deletes a comment of an open review cycle");
        }
    }

    /**
     * Nothing is moved into a cycle, where it would be one of its comments without having been
     * written in it, nor anything out of one, a comment or its Comments folder, but by an
     * administrator. A rename in place moves nothing: the trash renames a document so before it
     * trashes it, and the trash's own rules then apply.
     */
    private void aboutToMove(DocumentEventContext context, DocumentModel doc) {
        NuxeoPrincipal principal = context.getPrincipal();
        if (Refusal.isAdministrator(principal)) {
            return;
        }
        CoreSession session = context.getCoreSession();
        org.nuxeo.ecm.core.api.DocumentRef destination = context.getProperty(
                CoreEventConstants.DESTINATION_REF) instanceof org.nuxeo.ecm.core.api.DocumentRef ref ? ref : null;
        if (destination != null && doc.getParentRef() != null && Objects.equals(idOf(session, destination),
                idOf(session, doc.getParentRef()))) {
            return;
        }
        if (doc.hasFacet(COMMENT_FACET) || placeOf(session, doc.getParentRef()) != null) {
            throw forbidden("What a review cycle holds stays in its cycle");
        }
        if (destination != null && placeOf(session, destination) != null) {
            throw forbidden("Nothing is moved into a review cycle: its comments are written in it");
        }
    }

    /** The id of the document a reference names, read with a privileged session; {@code null} for none. */
    private static String idOf(CoreSession session, org.nuxeo.ecm.core.api.DocumentRef ref) {
        return CoreInstance.doPrivileged(session, (CoreSession s) -> s.exists(ref) ? s.getDocument(ref).getId() : null);
    }

    // ------------------------------------------------------------------ helpers

    private static boolean isReviewerOrOpener(DocumentModel cycle, String user) {
        return user != null && (user.equals(Stored.text(cycle, CYCLE_SCHEMA, RVW_OPENED_BY))
                || Stored.texts(cycle, CYCLE_SCHEMA, RVW_REVIEWERS).contains(user));
    }

    /** A document read with a privileged session, or {@code null} when there is none. */
    private static DocumentModel privileged(CoreSession session, String id) {
        return CoreInstance.doPrivileged(session, (CoreSession s) -> s.exists(new IdRef(id))
                ? s.getDocument(new IdRef(id))
                : null);
    }

    private static Calendar now() {
        return Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
    }

    private static ControlledDocumentService service() {
        ControlledDocumentService service = Framework.getService(ControlledDocumentService.class);
        if (service == null) {
            throw new NuxeoException("Review cycles: the service is not running");
        }
        return service;
    }

    private static NuxeoException refuse(Event event, DocumentEventContext context, DocumentModel doc,
            NuxeoException refusal) {
        return Refusal.refuse(log, "Review cycles", event, context, doc, refusal);
    }
}
