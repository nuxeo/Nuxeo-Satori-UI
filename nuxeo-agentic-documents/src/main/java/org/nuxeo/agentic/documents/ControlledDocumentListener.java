/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.nuxeo.agentic.documents.ControlledDocuments.CURRENT;
import static org.nuxeo.agentic.documents.ControlledDocuments.FACET;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_CLASSIFICATION;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_GROUPS;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_MARKED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_MARKED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_PROPERTIES;
import static org.nuxeo.agentic.documents.ControlledDocuments.MARK_SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.PROPERTIES;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVIEW_CYCLES;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVIEW_SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVISION;
import static org.nuxeo.agentic.documents.ControlledDocuments.SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.SERIES;
import static org.nuxeo.agentic.documents.ControlledDocuments.STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDED;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.SUPERSEDES;
import static org.nuxeo.agentic.documents.ControlledDocuments.isControlled;
import static org.nuxeo.agentic.documents.ControlledDocuments.isDocumentId;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.TimeZone;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentNotFoundException;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.DocumentRef;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.event.CoreEventConstants;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.api.facet.VersioningDocument;
import org.nuxeo.ecm.core.api.security.SecurityConstants;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.runtime.api.Framework;

/**
 * Numbers controlled documents, makes a new revision supersede the one before it, and keeps their
 * six properties the add-on's own.
 *
 * <p>Synchronous, so it runs in the transaction of the change that fires it, as the user who makes
 * it. Every refusal marks that transaction for rollback before it leaves, so nothing the change
 * wrote stays: a supersession refused after its new revision was created takes the revision with
 * it.
 *
 * <ul>
 * <li><strong>{@code aboutToCreate}:</strong> a new controlled document with no
 * {@code docctl:supersedes} is a first revision. Its creator chose a series; it is given that
 * series' next number from the platform's sequencer, the series' first revision, and the status
 * {@code current}. One that names the revision it supersedes is that revision's next: it is given
 * its predecessor's series and number and the next revision, once the predecessor is checked
 * ({@link #predecessor}). Whatever else the creator wrote in the six properties is replaced.</li>
 * <li><strong>{@code documentCreated}:</strong> the new revision now has its id. The predecessor
 * is checked again, claimed across the cluster ({@link ControlledDocumentService#claimSupersession}),
 * and marked {@code superseded}, {@code docctl:supersededBy} the new revision, written as the user,
 * in the same transaction.</li>
 * <li><strong>{@code beforeDocumentModification}:</strong> no change to the six properties as
 * stored, nor the facet added or removed, is let through, but the supersession above.</li>
 * <li><strong>{@code aboutToCopy}:</strong> a controlled document, or a folder holding one, is not
 * copied: the copy would carry its number.</li>
 * <li><strong>{@code beforeRestoringDocument}:</strong> a version is restored only when its six
 * properties are the live document's, so a superseded revision is never made current again.</li>
 * </ul>
 *
 * <p>And, since 0.3.0, the export-control mark ({@link ExportMarks}): a first revision's creator may
 * mark it when they hold {@value ExportMarks#PERMISSION} where they create it; a new revision takes
 * the mark of the one it supersedes, whatever its creator wrote; any later change of a mark, its
 * removal included, needs the permission on the revision; the server writes who and when, and each
 * one is audited ({@link ExportMarkAudit}). Who may change a mark is decided by where the revision
 * is, so a marked revision is placed elsewhere, by a move or by its next revision created in another
 * folder, only by a holder of the permission on it and on the folder it goes to.
 */
public class ControlledDocumentListener implements EventListener {

    private static final Logger log = LogManager.getLogger(ControlledDocumentListener.class);

    /**
     * The context data key the supersession's own write carries. Its value is {@link #SUPERSESSION},
     * compared by identity: a client can put a text or a number in a document's context data, never
     * this object.
     */
    static final String SUPERSESSION_KEY = "org.nuxeo.agentic.documents.supersession";

    private static final Supersession SUPERSESSION = new Supersession();

    /** Only the identity of the one instance counts, so it is never equal to a copy of itself. */
    private static final class Supersession implements Serializable {
        private static final long serialVersionUID = 1L;
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
                case DocumentEventTypes.ABOUT_TO_COPY -> aboutToCopy(context, doc);
                case DocumentEventTypes.BEFORE_DOC_RESTORE -> beforeRestore(context, doc);
                case DocumentEventTypes.ABOUT_TO_MOVE -> aboutToMove(context, doc);
                default -> {
                    // Not one of ours: the contribution lists the six above.
                }
            }
        } catch (NuxeoException e) {
            throw refuse(event, context, doc, e);
        } catch (RuntimeException e) {
            // Anything unforeseen refuses too: a change that could not be checked is not made.
            throw refuse(event, context, doc, new NuxeoException("Controlled documents: the change could not be "
                    + "checked, and is refused", e));
        }
    }

    // ------------------------------------------------------------------ creation

    private void aboutToCreate(DocumentEventContext context, DocumentModel doc) {
        if (!isControlled(doc)) {
            return;
        }
        if (!doc.getDocumentType().hasFacet(FACET)) {
            // Added to this one document, not given by its type: a type decides what is controlled.
            throw invalid("The " + FACET + " facet comes with a document's type: it is not added to a document");
        }
        String supersedes = value(doc, SUPERSEDES);
        if (supersedes == null) {
            markFirstRevision(context, doc);
            NumberSeries series = registered(value(doc, SERIES), "Choose a registered number series in "
                    + SERIES + " for a new controlled document");
            doc.setPropertyValue(SERIES, series.id());
            doc.setPropertyValue(NUMBER, service().nextNumber(series));
            doc.setPropertyValue(REVISION, series.revisions().first());
            // Blank or empty as written, it is written empty: every property is the server's own.
            doc.setPropertyValue(SUPERSEDES, null);
        } else {
            // Before the revision it supersedes is first read: its mark is then read after any change
            // of it this could cross has committed, and no change of it starts until this one ends.
            if (isDocumentId(supersedes) && !service().enterMark(supersedes)) {
                throw conflict("The export-control mark of the revision it supersedes, " + supersedes
                        + ", is being changed at this moment; try again");
            }
            DocumentModel previous = predecessor(context.getCoreSession(), doc, supersedes);
            carryMark(previous, doc);
            placedWithItsMark(context.getCoreSession(), previous, previous.getParentRef(), doc.getParentRef(),
                    "create its next revision in another folder");
            NumberSeries series = registered(value(previous, SERIES),
                    "The revision it supersedes is in a series no longer registered");
            String revision = series.revisions().next(value(previous, REVISION));
            if (revision == null) {
                throw conflict("The revision it supersedes, " + value(previous, REVISION)
                        + ", is not one series " + series.id() + " writes, so it has no next revision");
            }
            doc.setPropertyValue(SERIES, series.id());
            doc.setPropertyValue(NUMBER, value(previous, NUMBER));
            doc.setPropertyValue(REVISION, revision);
            doc.setPropertyValue(SUPERSEDES, previous.getId());
        }
        doc.setPropertyValue(STATUS, CURRENT);
        doc.setPropertyValue(SUPERSEDED_BY, null);
        if (doc.hasSchema(REVIEW_SCHEMA)) {
            // No review cycle has closed on a revision that does not exist yet.
            doc.setPropertyValue(REVIEW_CYCLES, null);
        }
    }

    private void documentCreated(DocumentEventContext context, DocumentModel doc) {
        if (!isControlled(doc)) {
            return;
        }
        String supersedes = value(doc, SUPERSEDES);
        ExportMarks.Mark mark = ExportMarks.read(doc);
        if (supersedes == null) {
            ExportMarkAudit.fire(context.getCoreSession(), context.getPrincipal(), doc,
                    ExportMarkAudit.change(ExportMarks.Mark.NONE, mark), ExportMarks.Mark.NONE, mark, null);
            return;
        }
        CoreSession session = context.getCoreSession();
        DocumentModel previous = predecessor(session, doc, supersedes);
        if (!ExportMarks.read(previous).equals(mark)) {
            throw conflict("The new revision's export-control mark is not the one it supersedes");
        }
        if (mark.isMarked()) {
            ExportMarkAudit.fire(session, context.getPrincipal(), doc, ExportMarkAudit.CARRIED, ExportMarks.Mark.NONE,
                    mark, previous.getId());
        }
        if (!Objects.equals(value(previous, NUMBER), value(doc, NUMBER))) {
            throw conflict("The new revision's number is not the one it supersedes");
        }
        // The repository lets two transactions write the same document at once, the last write
        // winning, so two revisions created at once could both find the old one current. One claim
        // per old revision, across the cluster, lets one of them through.
        if (!service().claimSupersession(previous.getId(), doc.getId())) {
            throw conflict("The revision it supersedes, " + previous.getId() + ", is being superseded by "
                    + "another revision at this moment");
        }
        previous.setPropertyValue(STATUS, SUPERSEDED);
        previous.setPropertyValue(SUPERSEDED_BY, doc.getId());
        previous.putContextData(SUPERSESSION_KEY, SUPERSESSION);
        // As the user, in this transaction: the platform checks their right to write it again.
        session.saveDocument(previous);
    }

    /**
     * The revision a new one supersedes, once checked: a live controlled document of the same
     * type, readable and writable by the user, current, not in the trash, with a number. Any other
     * is refused, and the creation with it.
     */
    private static DocumentModel predecessor(CoreSession session, DocumentModel revision, String id) {
        if (!isDocumentId(id)) {
            throw invalid(SUPERSEDES + " is not a document's id");
        }
        DocumentModel previous;
        try {
            previous = session.getDocument(new IdRef(id));
        } catch (DocumentNotFoundException e) {
            throw invalid("The revision it supersedes, " + id + ", does not exist");
        } catch (DocumentSecurityException e) {
            // As the platform answers a read of it: 403, for an id that exists.
            throw forbidden("You may not read the revision it supersedes, " + id);
        }
        if (!isControlled(previous)) {
            throw invalid("The document it supersedes, " + id + ", is not a live controlled document");
        }
        if (!previous.getType().equals(revision.getType())) {
            throw invalid("A revision is of its predecessor's type, " + previous.getType() + ", not "
                    + revision.getType());
        }
        if (previous.isTrashed()) {
            throw conflict("The revision it supersedes, " + id + ", is in the trash");
        }
        String by = value(previous, SUPERSEDED_BY);
        if (!CURRENT.equals(value(previous, STATUS)) || by != null) {
            throw conflict("The revision it supersedes, " + id + ", is not current"
                    + (by == null ? "" : ": it is superseded by " + by));
        }
        if (value(previous, NUMBER) == null) {
            throw conflict("The revision it supersedes, " + id + ", has no number");
        }
        if (!session.hasPermission(previous.getRef(), SecurityConstants.WRITE)) {
            throw forbidden("You may not write the revision this one supersedes, " + id
                    + ", so it cannot be marked superseded");
        }
        return previous;
    }

    private static NumberSeries registered(String id, String otherwise) {
        NumberSeries series = service().series(id);
        if (series == null) {
            // The id is the creator's text: it is named back only when it has a series id's form.
            String named = id == null ? ""
                    : NumberSeries.ID.matcher(id).matches() ? ": \"" + id + "\" is not registered"
                    : ": that is not a series id";
            throw invalid(otherwise + named);
        }
        if (series.transmittals()) {
            throw invalid(otherwise + ": series " + series.id() + " numbers transmittals, not documents");
        }
        return series;
    }

    // ------------------------------------------------------------------ guards

    private void beforeModification(DocumentEventContext context, DocumentModel doc) {
        DocumentModel previous = context.getProperty(CoreEventConstants.PREVIOUS_DOCUMENT_MODEL) instanceof DocumentModel p
                ? p
                : context.getCoreSession().getDocument(doc.getRef());
        boolean had = previous.hasFacet(FACET);
        boolean has = doc.hasFacet(FACET);
        if (!had && !has) {
            return;
        }
        if (had != has) {
            throw invalid("The " + FACET + " facet comes with a document's type: it is not added to a document "
                    + "or removed from one");
        }
        List<String> changed = changes(previous, doc);
        if (!changed.isEmpty() && !isSupersession(previous, doc, changed)) {
            throw invalid(String.join(", ", changed) + (changed.size() == 1 ? " is" : " are")
                    + " given by the server, and not changed");
        }
        if (!Stored.changes(previous, doc, REVIEW_SCHEMA, List.of(REVIEW_CYCLES)).isEmpty()
                && !isReviewRecord(previous, doc, changed)) {
            throw invalid(REVIEW_CYCLES + " is written by the server when a review cycle closes, and not changed");
        }
        changeMark(context, previous, doc);
    }

    // ------------------------------------------------------------------ the export-control mark

    /**
     * A first revision's mark, as its creator wrote it: checked, and written as the server keeps it,
     * with who and when, or none. Marking needs {@value ExportMarks#PERMISSION} on the folder the
     * revision is created in, which it inherits from.
     */
    private static void markFirstRevision(DocumentEventContext context, DocumentModel doc) {
        ExportMarks.Mark mark = ExportMarks.read(doc);
        checkMark(mark);
        if (mark.isMarked()) {
            CoreSession session = context.getCoreSession();
            if (doc.getParentRef() == null || !session.hasPermission(doc.getParentRef(), ExportMarks.PERMISSION)) {
                throw forbidden("You may not mark a new revision for export control here: it needs the "
                        + ExportMarks.PERMISSION + " permission on its folder");
            }
        }
        writeMark(doc, mark, mark.isMarked() ? Refusal.actingUser(context.getPrincipal(), null) : null,
                mark.isMarked() ? now() : null);
    }

    /** A new revision's mark is the one it supersedes, as stored, whatever its creator wrote. */
    private static void carryMark(DocumentModel previous, DocumentModel doc) {
        ExportMarks.Mark mark = ExportMarks.read(previous);
        Serializable at = previous.hasSchema(MARK_SCHEMA) ? previous.getPropertyValue(MARK_MARKED_AT) : null;
        writeMark(doc, mark, mark.isMarked() ? Stored.text(previous, MARK_SCHEMA, MARK_MARKED_BY) : null,
                mark.isMarked() && at instanceof Calendar calendar ? calendar : null);
    }

    /**
     * A save that changes the mark's classification or groups: checked, the permission held on the
     * revision, the revision's fence taken, and the mark written as the server keeps it, with who
     * and when, and audited. Who and when alone are the server's, and not changed.
     */
    private static void changeMark(DocumentEventContext context, DocumentModel previous, DocumentModel doc) {
        if (!doc.hasFacet(FACET) || !doc.hasSchema(MARK_SCHEMA)) {
            return;
        }
        List<String> changed = Stored.changes(previous, doc, MARK_SCHEMA, MARK_PROPERTIES);
        if (changed.isEmpty()) {
            return;
        }
        ExportMarks.Mark before = ExportMarks.read(previous);
        ExportMarks.Mark after = ExportMarks.read(doc);
        if (before.equals(after)) {
            if (changed.contains(MARK_MARKED_BY) || changed.contains(MARK_MARKED_AT)) {
                throw invalid(MARK_MARKED_BY + " and " + MARK_MARKED_AT + " are given by the server, and not changed");
            }
            // The same mark written back with blanks or padding: kept as stored, and no change.
            restoreMark(previous, doc);
            return;
        }
        if (doc.isProxy() || doc.isVersion()) {
            throw invalid("An export-control mark is changed on the revision itself, not through a proxy or a "
                    + "version");
        }
        checkMark(after);
        CoreSession session = context.getCoreSession();
        if (!session.hasPermission(doc.getRef(), ExportMarks.PERMISSION)) {
            throw forbidden("You may not " + (after.isMarked() ? "change" : "remove") + " this revision's "
                    + "export-control mark: it needs the " + ExportMarks.PERMISSION + " permission");
        }
        if (!service().changeMark(doc.getId())) {
            throw conflict("This revision's export-control mark is being read by a new revision or a transmittal, "
                    + "or changed by someone else, at this moment; try again");
        }
        writeMark(doc, after, Refusal.actingUser(context.getPrincipal(), null), now());
        ExportMarkAudit.fire(session, context.getPrincipal(), doc, ExportMarkAudit.change(before, after), before,
                after, null);
    }

    /**
     * Who may change a mark is decided by where the revision is: a marked revision, or the next
     * revision of one, goes to another folder only when the person holds {@value ExportMarks#PERMISSION}
     * on the revision and on that folder, 403 otherwise. In its own folder, or unmarked, nothing is
     * asked.
     */
    private static void placedWithItsMark(CoreSession session, DocumentModel revision, DocumentRef from,
            DocumentRef to, String what) {
        if (!ExportMarks.read(revision).isMarked() || sameFolder(session, from, to)) {
            return;
        }
        if (to == null || !session.hasPermission(revision.getRef(), ExportMarks.PERMISSION)
                || !session.hasPermission(to, ExportMarks.PERMISSION)) {
            throw forbidden("You may not " + what + ": who may change a revision's export-control mark is "
                    + "decided by where it is, so it needs the " + ExportMarks.PERMISSION
                    + " permission on the revision and on the folder it goes to");
        }
    }

    /** Whether two references name the same folder, read with a privileged session. */
    private static boolean sameFolder(CoreSession session, DocumentRef from, DocumentRef to) {
        if (from == null || to == null) {
            return false;
        }
        String a = idOf(session, from);
        return a != null && a.equals(idOf(session, to));
    }

    private static String idOf(CoreSession session, DocumentRef ref) {
        return CoreInstance.doPrivileged(session, (CoreSession s) -> s.exists(ref) ? s.getDocument(ref).getId() : null);
    }

    /**
     * A move of a marked revision, or of a folder holding one, read with a privileged session since
     * the move takes what the person may not read too: only by a holder of
     * {@value ExportMarks#PERMISSION} on it and on the folder it goes to. A rename in place moves
     * nothing: the trash renames a document so before it trashes it, naming its folder, and
     * {@code CoreSession.move} with no destination, which the platform renames in its own folder,
     * fires the event with none.
     */
    private void aboutToMove(DocumentEventContext context, DocumentModel doc) {
        CoreSession session = context.getCoreSession();
        DocumentRef to = context.getProperty(CoreEventConstants.DESTINATION_REF) instanceof DocumentRef ref ? ref
                : null;
        if (doc.isProxy() || doc.isVersion() || to == null) {
            return;
        }
        if (isControlled(doc)) {
            placedWithItsMark(session, doc, doc.getParentRef(), to, "move this marked revision");
            return;
        }
        if (doc.isFolder() && !sameFolder(session, doc.getParentRef(), to) && holdsMarked(session, doc)
                && (!session.hasPermission(doc.getRef(), ExportMarks.PERMISSION)
                        || !session.hasPermission(to, ExportMarks.PERMISSION))) {
            throw forbidden("You may not move this folder: it holds revisions with an export-control mark, and "
                    + "who may change a mark is decided by where the revision is, so it needs the "
                    + ExportMarks.PERMISSION + " permission on the folder and on the folder it goes to");
        }
    }

    /** Whether anything below a folder is a marked controlled document, read with a privileged session. */
    private static boolean holdsMarked(CoreSession session, DocumentModel folder) {
        String id = folder.getId();
        if (!isDocumentId(id)) {
            return true;
        }
        String query = "SELECT ecm:uuid FROM Document WHERE ecm:ancestorId = '" + id + "' AND ecm:mixinType = '"
                + FACET + "' AND " + MARK_CLASSIFICATION + " IS NOT NULL AND ecm:isProxy = 0";
        return CoreInstance.doPrivileged(session, (CoreSession privileged) -> !privileged.queryProjection(query, 1, 0)
                .isEmpty());
    }

    /** What is wrong with a mark written, refused; and each of its groups held to the user directory. */
    private static void checkMark(ExportMarks.Mark mark) {
        String problem = ExportMarks.problem(mark);
        if (problem != null) {
            throw invalid(problem);
        }
        if (mark.isMarked()) {
            String missing = ExportMarks.missingGroup(mark);
            if (missing != null) {
                throw invalid("No group is named " + missing + ": an export-control mark names groups the "
                        + "server has");
            }
        }
    }

    /** The mark written as the server keeps it: none, or its classification and groups, with who and when. */
    private static void writeMark(DocumentModel doc, ExportMarks.Mark mark, String by, Calendar at) {
        if (!doc.hasSchema(MARK_SCHEMA)) {
            return;
        }
        doc.setPropertyValue(MARK_CLASSIFICATION, mark.isMarked() ? mark.classification() : null);
        doc.setPropertyValue(MARK_GROUPS, mark.isMarked() ? (Serializable) List.copyOf(mark.groups()) : null);
        doc.setPropertyValue(MARK_MARKED_BY, by);
        doc.setPropertyValue(MARK_MARKED_AT, at);
    }

    /** The mark's four properties put back as the revision stores them. */
    private static void restoreMark(DocumentModel previous, DocumentModel doc) {
        for (String property : MARK_PROPERTIES) {
            doc.setPropertyValue(property, previous.getPropertyValue(property));
        }
    }

    private static Calendar now() {
        return Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
    }

    /**
     * The add-on's own record of a closed review cycle, and only that: one entry added after the
     * ones already there, nothing else of the revision's changed.
     */
    private static boolean isReviewRecord(DocumentModel previous, DocumentModel doc, List<String> changed) {
        if (!ServerWrite.REVIEW_RECORD.marks(doc) || !changed.isEmpty()) {
            return false;
        }
        List<?> before = listOf(Stored.value(previous, REVIEW_SCHEMA, REVIEW_CYCLES));
        List<?> after = listOf(Stored.value(doc, REVIEW_SCHEMA, REVIEW_CYCLES));
        return after.size() == before.size() + 1 && after.subList(0, before.size()).equals(before);
    }

    private static List<?> listOf(Object normal) {
        return normal instanceof List<?> list ? list : List.of();
    }

    /** The add-on's own write, and only that: current to superseded, by a document id. */
    private static boolean isSupersession(DocumentModel previous, DocumentModel doc, List<String> changed) {
        return doc.getContextData(SUPERSESSION_KEY) == SUPERSESSION
                && changed.equals(List.of(STATUS, SUPERSEDED_BY))
                && CURRENT.equals(value(previous, STATUS)) && value(previous, SUPERSEDED_BY) == null
                && SUPERSEDED.equals(value(doc, STATUS)) && isDocumentId(value(doc, SUPERSEDED_BY));
    }

    /**
     * A document of the add-on's, or a folder holding one, is not copied: a copy of a controlled
     * document would carry its number, and one of a transmittal, a receipt, a review cycle or one
     * of its comments would carry who issued, answered, opened or resolved it, and when.
     */
    private void aboutToCopy(DocumentEventContext context, DocumentModel source) {
        if (source.hasFacet(FACET)) {
            throw invalid("A controlled document is not copied, since the copy would carry its number: "
                    + "create a new document, or a new revision of it");
        }
        for (String facet : ControlledDocuments.FACETS) {
            if (source.hasFacet(facet)) {
                throw invalid("A " + facet + " is not copied, since the copy would carry what the server "
                        + "recorded on it");
            }
        }
        if (source.isFolder() && holdsControlled(context.getCoreSession(), source)) {
            throw invalid("This folder holds controlled documents, transmittals or review cycles, and is not "
                    + "copied, since each copy would carry its number or its record");
        }
    }

    /**
     * Whether anything below a folder is one of the add-on's documents, read with a privileged
     * session: a copy takes the whole tree, documents the user may not read included.
     */
    private static boolean holdsControlled(CoreSession session, DocumentModel folder) {
        String id = folder.getId();
        if (!isDocumentId(id)) {
            return true;
        }
        String facets = String.join("', '", ControlledDocuments.FACETS);
        String query = "SELECT ecm:uuid FROM Document WHERE ecm:ancestorId = '" + id + "' AND ecm:mixinType IN ('"
                + facets + "') AND ecm:isProxy = 0";
        return CoreInstance.doPrivileged(session, (CoreSession privileged) -> !privileged.queryProjection(query, 1, 0)
                .isEmpty());
    }

    /**
     * A version is restored over a document of the add-on's only when every property the add-on
     * keeps is the live document's already: a superseded revision is never made current again, a
     * closed cycle's record never dropped, an answered receipt never made to wait again.
     */
    private void beforeRestore(DocumentEventContext context, DocumentModel live) {
        Serializable versionId = context.getProperty(VersioningDocument.RESTORED_VERSION_UUID_KEY);
        if (versionId == null || !isDocumentId(versionId.toString())) {
            if (ControlledDocuments.FACETS.stream().anyMatch(live::hasFacet)) {
                throw invalid("The version to restore is not named, so it cannot be checked");
            }
            return;
        }
        DocumentModel version = context.getCoreSession().getDocument(new IdRef(versionId.toString()));
        List<String> changed = new ArrayList<>();
        for (Guarded guarded : GUARDED) {
            boolean liveHas = live.hasFacet(guarded.facet());
            boolean versionHas = version.hasFacet(guarded.facet());
            if (liveHas != versionHas) {
                changed.add("the " + guarded.facet() + " facet");
            } else if (liveHas) {
                changed.addAll(Stored.changes(live, version, guarded.schema(), guarded.properties()));
            }
        }
        if (!changed.isEmpty()) {
            throw conflict("Restoring this version would change " + String.join(", ", changed.stream()
                    .distinct()
                    .toList()) + ", which the server gives: it is not restored");
        }
    }

    /** A facet of the add-on's, and one of its schemas' properties the server keeps. */
    private record Guarded(String facet, String schema, List<String> properties) {
    }

    private static final List<Guarded> GUARDED = List.of(new Guarded(FACET, SCHEMA, PROPERTIES),
            new Guarded(FACET, REVIEW_SCHEMA, List.of(REVIEW_CYCLES)),
            new Guarded(FACET, MARK_SCHEMA, MARK_PROPERTIES),
            new Guarded(ControlledDocuments.TRANSMITTAL_FACET, ControlledDocuments.TRANSMITTAL_SCHEMA,
                    ControlledDocuments.TRANSMITTAL_PROPERTIES),
            new Guarded(ControlledDocuments.RECEIPT_FACET, ControlledDocuments.RECEIPT_SCHEMA,
                    ControlledDocuments.RECEIPT_PROPERTIES),
            new Guarded(ControlledDocuments.CYCLE_FACET, ControlledDocuments.CYCLE_SCHEMA,
                    ControlledDocuments.CYCLE_PROPERTIES),
            new Guarded(ControlledDocuments.COMMENT_FACET, ControlledDocuments.COMMENT_SCHEMA,
                    ControlledDocuments.COMMENT_PROPERTIES));

    // ------------------------------------------------------------------ helpers

    /** The six properties whose stored value differs from one document to the other ({@link Stored}). */
    private static List<String> changes(DocumentModel before, DocumentModel after) {
        return Stored.changes(before, after, SCHEMA, PROPERTIES);
    }

    /** A property of the schema, trimmed, {@code null} when empty or when the document lacks the schema. */
    private static String value(DocumentModel doc, String xpath) {
        return Stored.text(doc, SCHEMA, xpath);
    }

    private static ControlledDocumentService service() {
        ControlledDocumentService service = Framework.getService(ControlledDocumentService.class);
        if (service == null) {
            throw new NuxeoException("Controlled documents: the service is not running");
        }
        return service;
    }

    private static NuxeoException invalid(String message) {
        return Refusal.invalid(message);
    }

    private static NuxeoException conflict(String message) {
        return Refusal.conflict(message);
    }

    private static NuxeoException forbidden(String message) {
        return Refusal.forbidden(message);
    }

    private static NuxeoException refuse(Event event, DocumentEventContext context, DocumentModel doc,
            NuxeoException refusal) {
        return Refusal.refuse(log, "Controlled documents", event, context, doc, refusal);
    }
}
