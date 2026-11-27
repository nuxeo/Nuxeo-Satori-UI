/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import static org.nuxeo.agentic.capture.Refusal.conflict;
import static org.nuxeo.agentic.capture.Refusal.forbidden;
import static org.nuxeo.agentic.capture.Refusal.invalid;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.capture.Profile.CaptureClass;
import org.nuxeo.agentic.capture.Profile.CaptureField;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreInstance;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentNotFoundException;
import org.nuxeo.ecm.core.api.DocumentRef;
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
 * Capture items: received when created in their inbox; confirmed, corrected or rejected by a
 * person while they wait; and nothing of the server's changed by anyone else.
 *
 * <p>Synchronous, in the transaction of the change that fires it, as the person who makes it;
 * every refusal marks that transaction for rollback, with the status the REST API answers.
 *
 * <ul>
 * <li><strong>{@code aboutToCreate} of an item:</strong> it is created in a folder of the inbox type
 * a profile names for its type, with its file, no larger than the server takes, and with nothing of
 * {@code capt:} given. It is marked received, with its profile and the time; its capture runs in
 * the background once the creation commits ({@link CaptureIntakeListener}).</li>
 * <li><strong>{@code beforeDocumentModification} of an item:</strong> the server's properties are
 * the server's, and its file is what came in: neither changes. A person's properties change only
 * while it waits, {@value Captures#REVIEW}, and are checked; a decision acts on them: confirm files
 * it on its record, which the person must be able to write, and reject sets it aside.</li>
 * <li><strong>{@code documentCreatedByCopy}:</strong> an item is not copied, nor a folder holding
 * one: each is one piece of mail, filed once.</li>
 * <li><strong>{@code beforeRestoringDocument}:</strong> an item of a type that keeps versions is not
 * restored to one, which would put a filed or rejected item back to waiting.</li>
 * </ul>
 */
public class CaptureItemListener implements EventListener {

    private static final Logger log = LogManager.getLogger(CaptureItemListener.class);

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
                case DocumentEventTypes.BEFORE_DOC_UPDATE -> beforeModification(context, doc);
                case DocumentEventTypes.DOCUMENT_CREATED_BY_COPY -> copied(context, doc);
                case DocumentEventTypes.BEFORE_DOC_RESTORE -> {
                    if (doc.hasFacet(Captures.FACET)) {
                        throw invalid("A capture item is not restored to a version: what came in, and how it was "
                                + "decided, stay as they are");
                    }
                }
                default -> {
                    // Not one of ours: the contribution lists the four above.
                }
            }
        } catch (NuxeoException e) {
            throw Refusal.refuse(log, event, context, doc, e);
        } catch (RuntimeException e) {
            throw Refusal.refuse(log, event, context, doc,
                    new NuxeoException("Capture: the change could not be checked, and is refused", e));
        }
    }

    private static CaptureService service() {
        return Framework.getService(CaptureService.class);
    }

    // ------------------------------------------------------------------ receiving

    private void aboutToCreate(DocumentEventContext context, DocumentModel doc) {
        if (!doc.hasFacet(Captures.FACET)) {
            return;
        }
        if (doc.isProxy() || doc.isVersion()) {
            throw invalid("A capture item is created as itself, not as a proxy or a version");
        }
        List<String> given = Captures.PROPERTIES.stream().filter(p -> Stored.normal(doc.getPropertyValue(p)) != null).toList();
        if (!given.isEmpty()) {
            throw invalid(String.join(", ", given) + (given.size() == 1 ? " is" : " are")
                    + " not given when an item comes in: the server and then a person set them");
        }
        DocumentRef parentRef = doc.getParentRef();
        String inboxType = parentRef == null ? null
                : CoreInstance.doPrivileged(context.getCoreSession(), (CoreSession system) -> {
                    try {
                        return system.getDocument(parentRef).getType();
                    } catch (DocumentNotFoundException e) {
                        return null;
                    }
                });
        Profile profile = service().profileFor(inboxType, doc.getType());
        if (profile == null) {
            throw invalid("A capture item is created in an inbox, a folder of the type its profile names");
        }
        Blob file = doc.getPropertyValue(Captures.FILE) instanceof Blob blob ? blob : null;
        if (file == null) {
            throw invalid("A capture item is created with its file");
        }
        long maxBytes = service().settings().maxBytes();
        if (file.getLength() > maxBytes) {
            throw invalid("The file is larger than the inbox takes, " + maxBytes + " bytes");
        }
        doc.setPropertyValue(Captures.STATUS, Captures.RECEIVED);
        doc.setPropertyValue(Captures.PROFILE, profile.id());
        doc.setPropertyValue(Captures.RECEIVED_AT, Filing.now());
    }

    private void copied(DocumentEventContext context, DocumentModel doc) {
        if (doc.hasFacet(Captures.FACET)) {
            throw invalid("A capture item is not copied: it is one piece of mail, filed once");
        }
        if (doc.isFolder() && !doc.isProxy() && !doc.isVersion()) {
            String query = "SELECT * FROM Document WHERE ecm:mixinType = '" + Captures.FACET + "' AND ecm:ancestorId = '"
                    + doc.getId() + "'";
            boolean holds = CoreInstance.doPrivileged(context.getCoreSession(),
                    (CoreSession system) -> !system.query(query, 1).isEmpty());
            if (holds) {
                throw invalid("A folder that holds capture items is not copied: each is one piece of mail, filed once");
            }
        }
    }

    // ------------------------------------------------------------------ a person's part

    private void beforeModification(DocumentEventContext context, DocumentModel doc) {
        Object previousValue = context.getProperty(CoreEventConstants.PREVIOUS_DOCUMENT_MODEL);
        if (!doc.hasFacet(Captures.FACET) && !(previousValue instanceof DocumentModel p && p.hasFacet(Captures.FACET))) {
            return;
        }
        DocumentModel previous = previousValue instanceof DocumentModel p ? p
                : context.getCoreSession().getDocument(doc.getRef());
        if (previous.hasFacet(Captures.FACET) != doc.hasFacet(Captures.FACET)) {
            throw invalid("The CaptureItem facet comes with a document's type: it is not added to a document or "
                    + "removed from one");
        }
        if (ServerWrite.ITEM.consumes(doc)) {
            return;
        }
        List<String> server = Stored.changes(previous, doc, Captures.SCHEMA, Captures.SERVER_PROPERTIES);
        if (!server.isEmpty()) {
            throw invalid(String.join(", ", server) + (server.size() == 1 ? " is" : " are") + " the server's");
        }
        if (!Objects.equals(Stored.normal(previous.getPropertyValue(Captures.FILE)),
                Stored.normal(doc.getPropertyValue(Captures.FILE)))) {
            throw conflict("A capture item's file is what came in, and does not change");
        }
        List<String> person = Stored.changes(previous, doc, Captures.SCHEMA, Captures.PERSON_PROPERTIES);
        if (person.isEmpty()) {
            return;
        }
        if (!Captures.REVIEW.equals(Captures.text(previous, Captures.STATUS))) {
            throw conflict("Only an item waiting for a person is confirmed, corrected or rejected: this one is "
                    + Objects.requireNonNullElse(Captures.text(previous, Captures.STATUS), "not received"));
        }
        Profile profile = service().profile(Captures.text(previous, Captures.PROFILE));
        if (profile == null) {
            throw conflict("This item's capture profile is no longer on the server");
        }
        checkPersonValues(profile, doc);
        String decision = Captures.text(doc, Captures.DECISION);
        if (decision == null) {
            return;
        }
        switch (decision) {
            case Captures.CONFIRM -> confirm(context, profile, previous, doc);
            case Captures.REJECT -> reject(context, doc);
            default -> throw invalid("An item's decision is " + Captures.CONFIRM + " or " + Captures.REJECT);
        }
    }

    /** What a person gives, checked whatever they decide: a class of the profile, its fields, a record's id, a note. */
    private static void checkPersonValues(Profile profile, DocumentModel doc) {
        String className = Captures.text(doc, Captures.CLASS);
        CaptureClass captureClass = null;
        if (className != null) {
            captureClass = profile.captureClass(className)
                                  .orElseThrow(() -> invalid("An item's class is one of its profile's"));
        }
        List<Map<String, Serializable>> fields = Captures.entries(doc, Captures.FIELDS);
        if (fields.size() > Captures.MAX_FIELDS) {
            throw invalid("An item has " + Captures.MAX_FIELDS + " fields at most");
        }
        Set<String> names = new HashSet<>();
        for (Map<String, Serializable> field : fields) {
            String name = field.get("name") instanceof String s && !s.isEmpty() ? s : null;
            String value = field.get("value") instanceof String s ? s : null;
            // Checked before it is named in any message, which the server's log repeats.
            if (name == null || !Captures.NAME.matcher(name).matches()) {
                throw invalid("Each of an item's fields has a field's name: letters, digits, '_' and '-'");
            }
            if (captureClass == null) {
                throw invalid("An item's fields are its class's: give the class first");
            }
            if (captureClass.field(name).isEmpty()) {
                throw invalid("The field " + name + " is not one of class " + captureClass.name() + "'s");
            }
            if (!names.add(name)) {
                throw invalid("The field " + name + " is given twice");
            }
            if (value != null && (value.length() > Captures.MAX_VALUE || Captures.hasControl(value))) {
                throw invalid("A field's value is at most " + Captures.MAX_VALUE
                        + " characters, with no control character");
            }
        }
        String record = Captures.text(doc, Captures.RECORD);
        if (record != null && !Captures.DOCUMENT_ID.matcher(record).matches()) {
            throw invalid("An item's record is a record's id");
        }
        String note = Captures.text(doc, Captures.NOTE);
        if (note != null && (note.length() > Captures.MAX_NOTE
                || Captures.hasControl(note.replace('\n', ' ').replace('\r', ' ')))) {
            throw invalid("A note is at most " + Captures.MAX_NOTE + " characters, with no control character but a line's end");
        }
    }

    /** The fields a person gives, by name, those with a value. */
    private static Map<String, String> values(DocumentModel doc) {
        Map<String, String> values = new LinkedHashMap<>();
        for (Map<String, Serializable> field : Captures.entries(doc, Captures.FIELDS)) {
            if (field.get("name") instanceof String name && field.get("value") instanceof String value
                    && !value.isBlank()) {
                values.put(name, value.trim());
            }
        }
        return values;
    }

    private void confirm(DocumentEventContext context, Profile profile, DocumentModel previous, DocumentModel doc) {
        CoreSession session = context.getCoreSession();
        NuxeoPrincipal person = context.getPrincipal();
        CaptureClass captureClass = profile.captureClass(Captures.text(doc, Captures.CLASS))
                                           .orElseThrow(() -> invalid("An item is confirmed with its class"));
        Map<String, String> values = values(doc);
        for (CaptureField key : captureClass.keys()) {
            String value = values.get(key.name());
            if (value != null && !key.fits(value)) {
                throw invalid("The item's " + key.label() + " is not of its form");
            }
        }
        // The record: matched again by the keys when the person corrected a key and left the
        // record as it was, or gave none; otherwise the one they named.
        String recordId = Captures.text(doc, Captures.RECORD);
        boolean recordKept = Objects.equals(recordId, Captures.text(previous, Captures.RECORD));
        if (recordId == null || recordKept && !keys(captureClass, values).equals(keys(captureClass, values(previous)))) {
            recordId = matchOne(session, profile, captureClass, values);
        }
        DocumentModel record = readable(session, recordId);
        if (!Matcher.inScope(profile, record)) {
            throw invalid("The record is not one this inbox files on: a live " + profile.recordType()
                    + (profile.recordPath() == null ? "" : " under " + profile.recordPath()));
        }
        if (!record.hasSchema(Captures.ATTACHMENTS_SCHEMA)) {
            throw invalid("The record keeps no attachments to file the item on");
        }
        // The keys the person gave must be the record's; those they left empty are filled from it.
        for (CaptureField key : captureClass.keys()) {
            String held = record.getPropertyValue(key.match()) instanceof String s ? s : null;
            String given = values.get(key.name());
            if (given != null && !given.equals(held)) {
                throw invalid("The item's " + key.label() + " is not the record's: correct one or the other");
            }
            if (given == null && held != null) {
                values.put(key.name(), held);
            }
        }
        if (!session.hasPermission(record.getRef(), SecurityConstants.WRITE)) {
            throw forbidden("You may not write the record, so you may not file on it");
        }
        if (!Filing.claim(doc)) {
            throw conflict("The item is being filed at this moment");
        }
        String decidedBy = Refusal.actingUser(person, person == null ? "?" : person.getName());
        String outcome = corrected(previous, doc, captureClass, values, record.getId()) ? Captures.CORRECTED
                : Captures.CONFIRMED;
        String attachment = Filing.attach(session, doc, record);
        doc.setPropertyValue(Captures.FIELDS, (Serializable) fieldList(captureClass, values));
        Filing.markFiled(doc, record, attachment, outcome, decidedBy);
        Filing.audit(session, person, doc, record, attachment, outcome, decidedBy);
    }

    /** The class's keys among {@code values}, by name. */
    private static Map<String, String> keys(CaptureClass captureClass, Map<String, String> values) {
        Map<String, String> keys = new LinkedHashMap<>();
        for (CaptureField key : captureClass.keys()) {
            keys.put(key.name(), values.get(key.name()));
        }
        return keys;
    }

    /** The one record the keys match, as the system, or a refusal: none, or more than one. */
    private static String matchOne(CoreSession session, Profile profile, CaptureClass captureClass,
            Map<String, String> values) {
        Map<String, String> keys = new LinkedHashMap<>();
        for (CaptureField key : captureClass.keys()) {
            if (values.get(key.name()) != null) {
                keys.put(key.name(), values.get(key.name()));
            }
        }
        if (captureClass.keys().isEmpty() || keys.size() != captureClass.keys().size()) {
            throw invalid("Name the record to file the item on, or give each of its keys");
        }
        List<String> matches = CoreInstance.doPrivileged(session,
                (CoreSession system) -> Matcher.match(system, profile, captureClass, keys));
        if (matches.isEmpty()) {
            throw invalid("No record matches the item's keys: correct them, or name the record");
        }
        if (matches.size() > 1) {
            throw conflict("More than one record matches the item's keys: name the record");
        }
        return matches.get(0);
    }

    /** The record, read as the person: one they may not read is refused as if it were not there to them. */
    private static DocumentModel readable(CoreSession session, String recordId) {
        try {
            return session.getDocument(new IdRef(recordId));
        } catch (DocumentNotFoundException e) {
            throw invalid("The record named is not there");
        } catch (DocumentSecurityException e) {
            throw forbidden("You may not read the record named");
        }
    }

    /** Whether the person changed anything of the provider's proposal: the class, a field's value, or the record. */
    private static boolean corrected(DocumentModel previous, DocumentModel doc, CaptureClass captureClass,
            Map<String, String> values, String recordId) {
        if (!captureClass.name().equals(Captures.text(previous, Captures.PROPOSED_CLASS))) {
            return true;
        }
        if (!recordId.equals(Captures.text(previous, Captures.PROPOSED_RECORD))) {
            return true;
        }
        Map<String, String> proposed = new HashMap<>();
        for (Map<String, Serializable> field : Captures.entries(previous, Captures.EXTRACTED)) {
            if (field.get("name") instanceof String name && field.get("value") instanceof String value) {
                proposed.put(name, value);
            }
        }
        return !proposed.equals(values);
    }

    private static List<Map<String, Serializable>> fieldList(CaptureClass captureClass, Map<String, String> values) {
        List<Map<String, Serializable>> fields = new ArrayList<>();
        for (CaptureField field : captureClass.fields()) {
            String value = values.get(field.name());
            if (value != null) {
                Map<String, Serializable> entry = new HashMap<>();
                entry.put("name", field.name());
                entry.put("value", value);
                fields.add(entry);
            }
        }
        return fields;
    }

    private void reject(DocumentEventContext context, DocumentModel doc) {
        NuxeoPrincipal person = context.getPrincipal();
        String decidedBy = Refusal.actingUser(person, person == null ? "?" : person.getName());
        doc.setPropertyValue(Captures.STATUS, Captures.REJECTED);
        doc.setPropertyValue(Captures.REASON, null);
        doc.setPropertyValue(Captures.OUTCOME, Captures.REJECTED);
        doc.setPropertyValue(Captures.DECIDED_BY, decidedBy);
        doc.setPropertyValue(Captures.DECIDED_AT, Filing.now());
        doc.setPropertyValue(Captures.DECISION, null);
        CaptureAudit.rejected(context.getCoreSession(), person, doc, decidedBy);
    }
}
