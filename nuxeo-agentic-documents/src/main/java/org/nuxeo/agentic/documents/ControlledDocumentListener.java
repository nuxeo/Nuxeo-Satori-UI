/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.nuxeo.agentic.documents.ControlledDocuments.CURRENT;
import static org.nuxeo.agentic.documents.ControlledDocuments.FACET;
import static org.nuxeo.agentic.documents.ControlledDocuments.NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.PROPERTIES;
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
import java.util.List;
import java.util.Objects;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentNotFoundException;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
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
import org.nuxeo.runtime.transaction.TransactionHelper;

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
 * is checked again and marked {@code superseded}, {@code docctl:supersededBy} the new revision,
 * written as the user, in the same transaction.</li>
 * <li><strong>{@code beforeDocumentModification}:</strong> no change to the six properties, nor
 * the facet added or removed, is let through, but the supersession above.</li>
 * <li><strong>{@code aboutToCopy}:</strong> a controlled document, or a folder holding one, is not
 * copied: the copy would carry its number.</li>
 * <li><strong>{@code beforeRestoringDocument}:</strong> a version is restored only when its six
 * properties are the live document's, so a superseded revision is never made current again.</li>
 * </ul>
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
                default -> {
                    // Not one of ours: the contribution lists the five above.
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
            NumberSeries series = registered(value(doc, SERIES), "Choose a registered number series in "
                    + SERIES + " for a new controlled document");
            doc.setPropertyValue(SERIES, series.id());
            doc.setPropertyValue(NUMBER, service().nextNumber(series));
            doc.setPropertyValue(REVISION, series.revisions().first());
        } else {
            DocumentModel previous = predecessor(context.getCoreSession(), doc, supersedes);
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
    }

    private void documentCreated(DocumentEventContext context, DocumentModel doc) {
        if (!isControlled(doc)) {
            return;
        }
        String supersedes = value(doc, SUPERSEDES);
        if (supersedes == null) {
            return;
        }
        CoreSession session = context.getCoreSession();
        DocumentModel previous = predecessor(session, doc, supersedes);
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
        }
        // A user who may not read it gets the platform's own refusal, a DocumentSecurityException.
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
            throw new DocumentSecurityException("You may not write the revision this one supersedes, " + id
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
        if (changed.isEmpty() || isSupersession(previous, doc, changed)) {
            return;
        }
        throw invalid(String.join(", ", changed) + (changed.size() == 1 ? " is" : " are")
                + " given by the server, and not changed");
    }

    /** The add-on's own write, and only that: current to superseded, by a document id. */
    private static boolean isSupersession(DocumentModel previous, DocumentModel doc, List<String> changed) {
        return doc.getContextData(SUPERSESSION_KEY) == SUPERSESSION
                && changed.equals(List.of(STATUS, SUPERSEDED_BY))
                && CURRENT.equals(value(previous, STATUS)) && value(previous, SUPERSEDED_BY) == null
                && SUPERSEDED.equals(value(doc, STATUS)) && isDocumentId(value(doc, SUPERSEDED_BY));
    }

    private void aboutToCopy(DocumentEventContext context, DocumentModel source) {
        if (source.hasFacet(FACET)) {
            throw invalid("A controlled document is not copied, since the copy would carry its number: "
                    + "create a new document, or a new revision of it");
        }
        if (source.isFolder() && holdsControlled(context.getCoreSession(), source)) {
            throw invalid("This folder holds controlled documents, and is not copied, since each copy would "
                    + "carry its number");
        }
    }

    /**
     * Whether anything below a folder is a controlled document, read with a privileged session:
     * a copy takes the whole tree, documents the user may not read included.
     */
    private static boolean holdsControlled(CoreSession session, DocumentModel folder) {
        String id = folder.getId();
        if (!isDocumentId(id)) {
            return true;
        }
        String query = "SELECT ecm:uuid FROM Document WHERE ecm:ancestorId = '" + id + "' AND ecm:mixinType = '"
                + FACET + "' AND ecm:isProxy = 0";
        return CoreInstance.doPrivileged(session, (CoreSession privileged) -> !privileged.queryProjection(query, 1, 0)
                .isEmpty());
    }

    private void beforeRestore(DocumentEventContext context, DocumentModel live) {
        Serializable versionId = context.getProperty(VersioningDocument.RESTORED_VERSION_UUID_KEY);
        if (versionId == null || !isDocumentId(versionId.toString())) {
            if (live.hasFacet(FACET)) {
                throw invalid("The version to restore is not named, so it cannot be checked");
            }
            return;
        }
        DocumentModel version = context.getCoreSession().getDocument(new IdRef(versionId.toString()));
        if (!live.hasFacet(FACET) && !version.hasFacet(FACET)) {
            return;
        }
        List<String> changed = changes(live, version);
        if (!changed.isEmpty() || live.hasFacet(FACET) != version.hasFacet(FACET)) {
            throw conflict("Restoring this version would change " + (changed.isEmpty() ? "the " + FACET + " facet"
                    : String.join(", ", changed)) + ", which the server gives: it is not restored");
        }
    }

    // ------------------------------------------------------------------ helpers

    /** The properties whose value differs from one document to the other, in their order. */
    private static List<String> changes(DocumentModel before, DocumentModel after) {
        return PROPERTIES.stream().filter(p -> !Objects.equals(value(before, p), value(after, p))).toList();
    }

    /** A property of the schema, trimmed, {@code null} when empty or when the document lacks the schema. */
    private static String value(DocumentModel doc, String xpath) {
        return doc.hasSchema(SCHEMA) ? ControlledDocuments.text(doc, xpath) : null;
    }

    private static ControlledDocumentService service() {
        ControlledDocumentService service = Framework.getService(ControlledDocumentService.class);
        if (service == null) {
            throw new NuxeoException("Controlled documents: the service is not running");
        }
        return service;
    }

    private static NuxeoException invalid(String message) {
        return new NuxeoException(message, 400);
    }

    private static NuxeoException conflict(String message) {
        return new NuxeoException(message, 409);
    }

    /**
     * Mark the transaction for rollback, and have the event service throw the refusal on to the
     * caller rather than log it: the platform swallows a synchronous listener's exception
     * otherwise.
     */
    private static NuxeoException refuse(Event event, DocumentEventContext context, DocumentModel doc,
            NuxeoException refusal) {
        TransactionHelper.setTransactionRollbackOnly();
        event.markBubbleException();
        String user = context.getPrincipal() == null ? "?" : context.getPrincipal().getName();
        log.info("Controlled documents: {} of {} ({}) by {} refused: {}", event.getName(), doc.getId(),
                doc.getType(), user, refusal.getMessage());
        return refusal;
    }
}
