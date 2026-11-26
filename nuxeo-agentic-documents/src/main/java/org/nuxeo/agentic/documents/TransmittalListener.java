/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.documents;

import static org.nuxeo.agentic.documents.ControlledDocuments.ACKNOWLEDGED;
import static org.nuxeo.agentic.documents.ControlledDocuments.AWAITING;
import static org.nuxeo.agentic.documents.ControlledDocuments.CURRENT;
import static org.nuxeo.agentic.documents.ControlledDocuments.FACET;
import static org.nuxeo.agentic.documents.ControlledDocuments.NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.PURPOSES;
import static org.nuxeo.agentic.documents.ControlledDocuments.RECEIPT_FACET;
import static org.nuxeo.agentic.documents.ControlledDocuments.RECEIPT_PROPERTIES;
import static org.nuxeo.agentic.documents.ControlledDocuments.RECEIPT_SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.RETURNED;
import static org.nuxeo.agentic.documents.ControlledDocuments.REVISION;
import static org.nuxeo.agentic.documents.ControlledDocuments.SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRANSMITTAL_FACET;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRANSMITTAL_PROPERTIES;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRANSMITTAL_SCHEMA;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_DOCUMENTS;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_DUE_DATE;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_ISSUED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_ISSUED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_ITEMS;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_PURPOSE;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRM_RECIPIENTS;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_COMMENT;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_DUE_DATE;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_ISSUED_BY;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_NUMBER;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_PURPOSE;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_RECIPIENT;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_RESPONDED_AT;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_STATUS;
import static org.nuxeo.agentic.documents.ControlledDocuments.TRR_TRANSMITTAL;
import static org.nuxeo.agentic.documents.ControlledDocuments.isDocumentId;
import static org.nuxeo.agentic.documents.ControlledDocuments.isLive;
import static org.nuxeo.agentic.documents.ControlledDocuments.isUserName;
import static org.nuxeo.agentic.documents.Refusal.conflict;
import static org.nuxeo.agentic.documents.Refusal.forbidden;
import static org.nuxeo.agentic.documents.Refusal.invalid;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentModelList;
import org.nuxeo.ecm.core.api.DocumentNotFoundException;
import org.nuxeo.ecm.core.api.DocumentSecurityException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.ecm.core.api.NuxeoException;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.ecm.core.api.event.CoreEventConstants;
import org.nuxeo.ecm.core.api.event.DocumentEventTypes;
import org.nuxeo.ecm.core.event.Event;
import org.nuxeo.ecm.core.event.EventListener;
import org.nuxeo.ecm.core.event.impl.DocumentEventContext;
import org.nuxeo.ecm.core.schema.SchemaManager;
import org.nuxeo.runtime.api.Framework;

/**
 * Transmittals: issued on creation, one receipt per recipient made beside them, and each receipt
 * answered once, by its recipient alone.
 *
 * <p>Synchronous, in the transaction of the change that fires it, as the user who makes it, as
 * {@link ControlledDocumentListener} is; every refusal marks that transaction for rollback.
 *
 * <ul>
 * <li><strong>{@code aboutToCreate} of a transmittal:</strong> it is issued. Its documents, each
 * named by number or id, are each the current revision the issuer may read, written back as ids,
 * with their number, revision and title as they are now; its recipients are user names; its
 * purpose one of three; its due day not past. Then it is given the next number of the series
 * registered for transmittals, who issued it and when.</li>
 * <li><strong>{@code documentCreated} of a transmittal:</strong> a receipt per recipient, beside
 * it, created as the issuer, {@value ControlledDocuments#AWAITING}.</li>
 * <li><strong>{@code aboutToCreate} of a receipt:</strong> refused, unless it is the add-on's own,
 * just above.</li>
 * <li><strong>{@code beforeDocumentModification}:</strong> a transmittal is not changed once
 * issued. A receipt is answered once, {@value ControlledDocuments#ACKNOWLEDGED} or
 * {@value ControlledDocuments#RETURNED} with a comment, by its recipient alone, an administrator
 * included; the server writes when. Nothing else of it changes, then or after.</li>
 * <li><strong>{@code aboutToRemove} and {@code documentTrashed}:</strong> a transmittal and its
 * receipts are kept; only an administrator deletes or trashes one.</li>
 * </ul>
 */
public class TransmittalListener implements EventListener {

    private static final Logger log = LogManager.getLogger(TransmittalListener.class);

    static final int MAX_DOCUMENTS = 100;

    static final int MAX_RECIPIENTS = 50;

    static final int MAX_TITLE = 200;

    static final int MAX_COMMENT = 4000;

    /** {@code Ms} of a day, for a due day: one before today's in UTC is let through, for zones behind it. */
    private static final long DAY = 24L * 60 * 60 * 1000;

    /**
     * A document number as a series writes it: a series id, a hyphen, digits. A series id is
     * capitals and digits in parts joined by hyphens, so the last hyphen parts it from the digits.
     */
    private static final Pattern DOCUMENT_NUMBER = Pattern.compile("(?=.{1,64}$)([A-Z0-9]+(?:-[A-Z0-9]+)*)-([0-9]+)");

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
                case DocumentEventTypes.ABOUT_TO_REMOVE, "documentTrashed" -> kept(context, doc);
                default -> {
                    // Not one of ours: the contribution lists the five above.
                }
            }
        } catch (NuxeoException e) {
            throw refuse(event, context, doc, e);
        } catch (RuntimeException e) {
            throw refuse(event, context, doc, new NuxeoException("Transmittals: the change could not be checked, "
                    + "and is refused", e));
        }
    }

    // ------------------------------------------------------------------ issue

    private void aboutToCreate(DocumentEventContext context, DocumentModel doc) {
        if (doc.hasFacet(RECEIPT_FACET)) {
            byType(doc, RECEIPT_FACET);
            if (!isLive(doc, RECEIPT_FACET) || !ServerWrite.RECEIPT.marks(doc)) {
                throw forbidden("A transmittal's receipt is written by the server when the transmittal is issued, "
                        + "one for each recipient");
            }
            return;
        }
        if (!doc.hasFacet(TRANSMITTAL_FACET)) {
            return;
        }
        byType(doc, TRANSMITTAL_FACET);
        if (!isLive(doc, TRANSMITTAL_FACET)) {
            return;
        }
        CoreSession session = context.getCoreSession();
        String title = ControlledDocuments.text(doc, "dc:title");
        if (title == null) {
            throw invalid("A transmittal needs a subject, in its title");
        }
        if (title.length() > MAX_TITLE) {
            throw invalid("A transmittal's subject is " + MAX_TITLE + " characters at most");
        }
        String purpose = Stored.text(doc, TRANSMITTAL_SCHEMA, TRM_PURPOSE);
        if (purpose == null || !PURPOSES.contains(purpose)) {
            throw invalid(TRM_PURPOSE + " is one of " + String.join(", ", PURPOSES));
        }
        Calendar due = day(doc.getPropertyValue(TRM_DUE_DATE));
        if (due == null) {
            throw invalid("A transmittal needs a due day, in " + TRM_DUE_DATE);
        }
        if (due.getTimeInMillis() < startOfToday() - DAY) {
            throw invalid("A transmittal's due day is today or later");
        }
        List<String> recipients = distinct(Stored.texts(doc, TRANSMITTAL_SCHEMA, TRM_RECIPIENTS));
        if (recipients.isEmpty() || recipients.size() > MAX_RECIPIENTS) {
            throw invalid("A transmittal goes to 1 to " + MAX_RECIPIENTS + " recipients, by user name, in "
                    + TRM_RECIPIENTS);
        }
        for (String recipient : recipients) {
            if (!isUserName(recipient)) {
                throw invalid("A recipient is a user name: letters, digits and @ . _ + -");
            }
        }
        List<String> named = distinct(Stored.texts(doc, TRANSMITTAL_SCHEMA, TRM_DOCUMENTS));
        if (named.isEmpty() || named.size() > MAX_DOCUMENTS) {
            throw invalid("A transmittal lists 1 to " + MAX_DOCUMENTS + " controlled documents, each by its "
                    + "number or its id, in " + TRM_DOCUMENTS);
        }
        List<String> ids = new ArrayList<>();
        List<Map<String, Serializable>> items = new ArrayList<>();
        for (String entry : named) {
            DocumentModel revision = currentRevision(session, entry);
            if (ids.contains(revision.getId())) {
                continue;
            }
            ids.add(revision.getId());
            Map<String, Serializable> item = new HashMap<>();
            item.put("document", revision.getId());
            item.put("number", ControlledDocuments.text(revision, NUMBER));
            item.put("revision", ControlledDocuments.text(revision, REVISION));
            item.put("title", ControlledDocuments.text(revision, "dc:title"));
            items.add(item);
        }
        List<NumberSeries> series = service().transmittalSeries();
        if (series.size() != 1) {
            throw invalid(series.isEmpty() ? "No number series is registered for transmittals"
                    : "More than one number series is registered for transmittals: "
                            + String.join(", ", series.stream().map(NumberSeries::id).toList()));
        }
        // Last, once nothing else can refuse it: a number taken is never given back.
        doc.setPropertyValue(TRM_NUMBER, service().nextNumber(series.get(0)));
        doc.setPropertyValue(TRM_DOCUMENTS, (Serializable) ids);
        doc.setPropertyValue(TRM_ITEMS, (Serializable) items);
        doc.setPropertyValue(TRM_RECIPIENTS, (Serializable) recipients);
        doc.setPropertyValue(TRM_PURPOSE, purpose);
        doc.setPropertyValue(TRM_DUE_DATE, due);
        doc.setPropertyValue(TRM_ISSUED_BY, Refusal.actingUser(context.getPrincipal(), null));
        doc.setPropertyValue(TRM_ISSUED_AT, Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT));
    }

    /**
     * The current revision an entry names, as the issuer may read it: by its number, the one
     * revision of that number that is current, or by its id, which must be that revision.
     */
    private static DocumentModel currentRevision(CoreSession session, String entry) {
        Matcher number = DOCUMENT_NUMBER.matcher(entry);
        if (number.matches() && service().series(number.group(1)) != null) {
            // Its form is checked above, so it is written into the query as it is.
            String query = "SELECT * FROM Document WHERE ecm:mixinType = '" + FACET + "' AND docctl:number = '"
                    + entry + "' AND docctl:status = '" + CURRENT + "' AND ecm:isVersion = 0 AND ecm:isProxy = 0 "
                    + "AND ecm:isTrashed = 0";
            DocumentModelList found = session.query(query, 2);
            if (found.isEmpty()) {
                throw invalid("No current revision of " + entry + " that you may read");
            }
            if (found.size() > 1) {
                throw conflict("More than one current revision of " + entry);
            }
            return found.get(0);
        }
        if (!isDocumentId(entry)) {
            throw invalid("A transmittal's document is named by its number, such as DWG-00042, or its id");
        }
        DocumentModel revision;
        try {
            revision = session.getDocument(new IdRef(entry));
        } catch (DocumentNotFoundException e) {
            throw invalid("No document has the id " + entry);
        } catch (DocumentSecurityException e) {
            throw forbidden("You may not read the document " + entry);
        }
        if (!isLive(revision, FACET)) {
            throw invalid("The document " + entry + " is not a live controlled document");
        }
        if (revision.isTrashed()) {
            throw conflict("The document " + entry + " is in the trash");
        }
        if (!CURRENT.equals(Stored.text(revision, SCHEMA, STATUS))) {
            throw conflict("The document " + entry + " is not its number's current revision: a transmittal sends "
                    + "current revisions");
        }
        return revision;
    }

    // ------------------------------------------------------------------ receipts

    private void documentCreated(DocumentEventContext context, DocumentModel doc) {
        if (!isLive(doc, TRANSMITTAL_FACET)) {
            return;
        }
        CoreSession session = context.getCoreSession();
        String receiptType = receiptType();
        String number = Stored.text(doc, TRANSMITTAL_SCHEMA, TRM_NUMBER);
        if (number == null || doc.getPath() == null || doc.getPath().segmentCount() < 1) {
            throw conflict("The transmittal was not issued, so it has no receipts");
        }
        // Beside it: where its issuer could create it, so where they may create its receipts.
        String folder = doc.getPath().removeLastSegments(1).toString();
        String title = number + " " + ControlledDocuments.text(doc, "dc:title");
        int index = 0;
        for (String recipient : Stored.texts(doc, TRANSMITTAL_SCHEMA, TRM_RECIPIENTS)) {
            index++;
            // Short, for Nuxeo cuts a name to 24 characters: the number's digits and the recipient's place.
            DocumentModel receipt = session.createDocumentModel(folder, number.toLowerCase(Locale.ROOT) + "-" + index,
                    receiptType);
            receipt.setPropertyValue("dc:title", title);
            receipt.setPropertyValue(TRR_TRANSMITTAL, doc.getId());
            receipt.setPropertyValue(TRR_NUMBER, number);
            receipt.setPropertyValue(TRR_RECIPIENT, recipient);
            receipt.setPropertyValue(TRR_PURPOSE, Stored.text(doc, TRANSMITTAL_SCHEMA, TRM_PURPOSE));
            receipt.setPropertyValue(TRR_DUE_DATE, doc.getPropertyValue(TRM_DUE_DATE));
            receipt.setPropertyValue(TRR_ISSUED_BY, Stored.text(doc, TRANSMITTAL_SCHEMA, TRM_ISSUED_BY));
            receipt.setPropertyValue(TRR_STATUS, AWAITING);
            ServerWrite.RECEIPT.mark(receipt);
            // As the issuer, who may create where they issued it: held to their permissions.
            session.createDocument(receipt);
        }
    }

    /** The one document type that carries the receipt facet: a kit's. */
    private static String receiptType() {
        Set<String> types = Framework.getService(SchemaManager.class).getDocumentTypeNamesForFacet(RECEIPT_FACET);
        if (types == null || types.size() != 1) {
            throw invalid("A transmittal needs one document type with the " + RECEIPT_FACET + " facet for its "
                    + "receipts, and the server has " + (types == null ? 0 : types.size()));
        }
        return types.iterator().next();
    }

    // ------------------------------------------------------------------ changes

    private void beforeModification(DocumentEventContext context, DocumentModel doc) {
        DocumentModel previous = context.getProperty(CoreEventConstants.PREVIOUS_DOCUMENT_MODEL) instanceof DocumentModel p
                ? p
                : context.getCoreSession().getDocument(doc.getRef());
        for (String facet : List.of(TRANSMITTAL_FACET, RECEIPT_FACET)) {
            if (previous.hasFacet(facet) != doc.hasFacet(facet)) {
                throw invalid("The " + facet + " facet comes with a document's type: it is not added to a document "
                        + "or removed from one");
            }
        }
        if (doc.hasFacet(TRANSMITTAL_FACET)) {
            List<String> changed = changes(previous, doc, TRANSMITTAL_SCHEMA, TRANSMITTAL_PROPERTIES);
            if (!changed.isEmpty()) {
                throw invalid("A transmittal is not changed once issued: " + String.join(", ", changed));
            }
        } else if (doc.hasFacet(RECEIPT_FACET)) {
            answer(context, previous, doc);
        }
    }

    /**
     * A receipt's one change: its recipient's answer, once. Any other change to it is refused,
     * before and after, by anyone.
     */
    private void answer(DocumentEventContext context, DocumentModel previous, DocumentModel doc) {
        List<String> changed = changes(previous, doc, RECEIPT_SCHEMA, RECEIPT_PROPERTIES);
        if (changed.isEmpty()) {
            return;
        }
        if (!isLive(doc, RECEIPT_FACET)) {
            throw invalid("A receipt is answered on itself, not through a proxy or a version");
        }
        if (!AWAITING.equals(Stored.text(previous, RECEIPT_SCHEMA, TRR_STATUS))) {
            throw conflict("This receipt has been answered, and an answer is not changed");
        }
        List<String> others = changed.stream().filter(p -> !p.equals(TRR_STATUS) && !p.equals(TRR_COMMENT)).toList();
        if (!others.isEmpty()) {
            throw invalid(String.join(", ", others) + (others.size() == 1 ? " is" : " are")
                    + " given by the server, and not changed");
        }
        String recipient = Stored.text(previous, RECEIPT_SCHEMA, TRR_RECIPIENT);
        NuxeoPrincipal principal = context.getPrincipal();
        String user = Refusal.actingUser(principal, null);
        if (recipient == null || !recipient.equals(user)) {
            // No exemption, an administrator's included: an answer is the recipient's own.
            throw forbidden("Only the recipient this transmittal was sent to, " + recipient
                    + ", acknowledges or returns it");
        }
        String status = Stored.text(doc, RECEIPT_SCHEMA, TRR_STATUS);
        if (!ACKNOWLEDGED.equals(status) && !RETURNED.equals(status)) {
            throw invalid("Answer " + TRR_STATUS + " with " + ACKNOWLEDGED + ", or " + RETURNED + " with a comment");
        }
        String comment = Stored.text(doc, RECEIPT_SCHEMA, TRR_COMMENT);
        if (RETURNED.equals(status) && comment == null) {
            throw invalid("A transmittal returned says why, in " + TRR_COMMENT);
        }
        if (comment != null && comment.length() > MAX_COMMENT) {
            throw invalid("A comment is " + MAX_COMMENT + " characters at most");
        }
        // Two answers at once, from two windows, would both find it awaiting: one claim lets one through.
        if (!service().claim("receipt." + doc.getId(), status)) {
            throw conflict("This receipt is being answered at this moment");
        }
        doc.setPropertyValue(TRR_STATUS, status);
        doc.setPropertyValue(TRR_COMMENT, comment);
        doc.setPropertyValue(TRR_RESPONDED_AT, Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT));
    }

    /** The add-on's properties that changed, and the title and description, which are the issuer's. */
    private static List<String> changes(DocumentModel previous, DocumentModel doc, String schema,
            List<String> properties) {
        List<String> changed = new ArrayList<>(Stored.changes(previous, doc, schema, properties));
        changed.addAll(Stored.changes(previous, doc, "dublincore", List.of("dc:title", "dc:description")));
        return changed;
    }

    private void kept(DocumentEventContext context, DocumentModel doc) {
        if (!doc.hasFacet(TRANSMITTAL_FACET) && !doc.hasFacet(RECEIPT_FACET)) {
            return;
        }
        NuxeoPrincipal principal = context.getPrincipal();
        if (!Refusal.isAdministrator(principal)) {
            throw forbidden("A transmittal and its receipts are kept: only an administrator deletes or trashes one");
        }
        log.warn("Transmittals: {} deletes or trashes the {} {}", principal.getName(), doc.getType(), doc.getId());
    }

    // ------------------------------------------------------------------ helpers

    private static void byType(DocumentModel doc, String facet) {
        if (!doc.getDocumentType().hasFacet(facet)) {
            throw invalid("The " + facet + " facet comes with a document's type: it is not added to a document");
        }
    }

    private static List<String> distinct(List<String> values) {
        return List.copyOf(new LinkedHashSet<>(values));
    }

    /** A day, as Nuxeo stores one: the calendar, or {@code null} when it is none. */
    private static Calendar day(Serializable value) {
        if (value instanceof Calendar calendar) {
            return calendar;
        }
        if (value instanceof java.util.Date date) {
            Calendar calendar = new GregorianCalendar(TimeZone.getTimeZone("UTC"), Locale.ROOT);
            calendar.setTime(date);
            return calendar;
        }
        return null;
    }

    /** Today's midnight, in UTC, as Nuxeo writes a day. */
    static long startOfToday() {
        long now = System.currentTimeMillis();
        return now - Math.floorMod(now, DAY);
    }

    private static ControlledDocumentService service() {
        ControlledDocumentService service = Framework.getService(ControlledDocumentService.class);
        if (service == null) {
            throw new NuxeoException("Transmittals: the service is not running");
        }
        return service;
    }

    private static NuxeoException refuse(Event event, DocumentEventContext context, DocumentModel doc,
            NuxeoException refusal) {
        return Refusal.refuse(log, "Transmittals", event, context, doc, refusal);
    }
}
