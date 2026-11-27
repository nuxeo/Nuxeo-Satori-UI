/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.NuxeoPrincipal;
import org.nuxeo.runtime.api.Framework;

/**
 * Filing an item on its record, the one way both an automatic filing and a person's take: the
 * item's file added to the record's attachments, {@code files:files}, through the session given,
 * the system's or the person's; the item marked filed, with who, when, how and the file's name on
 * the record; and the audit's two entries. An attachment whose file is already the record's, by the
 * platform's digest, is not added twice.
 *
 * <p>Each filing claims its item first, in the key/value store, for a day, released when its
 * transaction does not commit: so an item is filed once, whoever files it, whatever runs at the
 * same moment.
 */
final class Filing {

    /** How long an item's filing claim holds: past any transaction. */
    static final long CLAIM_TTL = 86_400;

    /** How long an item's capture claim holds: past any capture's transaction. */
    static final long CAPTURE_TTL = 3_600;

    private Filing() {
    }

    static String claimKey(String itemId) {
        return "file." + itemId;
    }

    static String captureKey(String itemId) {
        return "capture." + itemId;
    }

    private static CaptureComponent component() {
        return (CaptureComponent) Framework.getService(CaptureService.class);
    }

    /** Claim the item's filing; {@code false} when another filing of it holds the claim. */
    static boolean claim(DocumentModel item) {
        return component().claim(claimKey(item.getId()), "claimed", CLAIM_TTL);
    }

    /**
     * Claim the item's capture as {@code run}, one capture's own token, so that two captures of it,
     * a redelivery's and the first, never run at once and never write over each other. Kept once
     * its transaction commits, by when the item is no longer received; released when it does not.
     * {@code true} when {@code run} holds it already.
     */
    static boolean claimCapture(String itemId, String run) {
        String key = captureKey(itemId);
        return run.equals(component().claimed(key)) || component().claim(key, run, CAPTURE_TTL);
    }

    /**
     * Add the item's file to the record's attachments, through {@code session}, and save the record.
     * Returns the file's name as the record holds it.
     */
    static String attach(CoreSession session, DocumentModel item, DocumentModel record) {
        Blob file = (Blob) item.getPropertyValue(Captures.FILE);
        String name = Captures.clean(file.getFilename(), 255);
        List<Map<String, Serializable>> attachments = new ArrayList<>(Captures.entries(record, Captures.ATTACHMENTS));
        String digest = file.getDigest();
        for (Map<String, Serializable> attachment : attachments) {
            if (attachment.get("file") instanceof Blob held && digest != null && digest.equals(held.getDigest())
                    && held.getLength() == file.getLength()) {
                return Captures.clean(held.getFilename(), 255);
            }
        }
        Map<String, Serializable> attachment = new HashMap<>();
        attachment.put("file", (Serializable) file);
        attachments.add(attachment);
        record.setPropertyValue(Captures.ATTACHMENTS, (Serializable) attachments);
        session.saveDocument(record);
        return name;
    }

    /** The item marked filed: on the model given, which its caller saves. */
    static void markFiled(DocumentModel item, DocumentModel record, String attachment, String outcome, String decidedBy) {
        item.setPropertyValue(Captures.STATUS, Captures.FILED);
        item.setPropertyValue(Captures.REASON, null);
        item.setPropertyValue(Captures.OUTCOME, outcome);
        item.setPropertyValue(Captures.DECIDED_BY, decidedBy);
        item.setPropertyValue(Captures.DECIDED_AT, now());
        item.setPropertyValue(Captures.RECORD, record.getId());
        item.setPropertyValue(Captures.ATTACHMENT, attachment);
        item.setPropertyValue(Captures.DECISION, null);
    }

    static void audit(CoreSession session, NuxeoPrincipal by, DocumentModel item, DocumentModel record,
            String attachment, String outcome, String decidedBy) {
        Serializable confidence = item.getPropertyValue(Captures.CONFIDENCE);
        CaptureAudit.filed(session, by, item, record, attachment, Captures.text(item, Captures.CLASS),
                Captures.confidence(confidence), outcome, decidedBy);
    }

    static Calendar now() {
        return new GregorianCalendar(TimeZone.getTimeZone("UTC"));
    }
}
