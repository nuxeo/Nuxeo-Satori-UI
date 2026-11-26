/*
 * Licensed under the Apache License, Version 2.0
 */
package org.nuxeo.agentic.capture;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.nuxeo.agentic.capture.CaptureProvider.Classification;
import org.nuxeo.agentic.capture.CaptureProvider.ExtractedField;
import org.nuxeo.agentic.capture.CaptureProvider.Extraction;
import org.nuxeo.agentic.capture.CaptureProvider.Submission;
import org.nuxeo.agentic.capture.ConfidenceRule.Verdict;
import org.nuxeo.ecm.core.api.Blob;
import org.nuxeo.ecm.core.api.CoreSession;
import org.nuxeo.ecm.core.api.DocumentModel;
import org.nuxeo.ecm.core.api.DocumentNotFoundException;
import org.nuxeo.ecm.core.api.IdRef;
import org.nuxeo.runtime.api.Framework;

/**
 * One item's capture, as the system, in the background, in a transaction of its own: classified
 * and its fields extracted through the server's provider, judged by the {@link ConfidenceRule},
 * matched ({@link Matcher}), and filed ({@link Filing}) or queued for a person. Only an item still
 * {@value Captures#RECEIVED} is taken, so a capture run twice files nothing twice; the filing claim
 * holds against everything else.
 *
 * <p>The provider's answer is kept on the item as its proposal, whatever it was, and the person's
 * fields are set from it, so that a person confirms with nothing to type when it is right. Nothing
 * of the item, its file or the provider's answer is logged: an item's id, its reason and a
 * provider's kind of failure only.
 */
final class Capture {

    private static final Logger log = LogManager.getLogger(Capture.class);

    private Capture() {
    }

    static void run(CoreSession system, String itemId) {
        DocumentModel item;
        try {
            item = system.getDocument(new IdRef(itemId));
        } catch (DocumentNotFoundException e) {
            return;
        }
        if (!item.hasFacet(Captures.FACET) || !Captures.isLive(item)
                || !Captures.RECEIVED.equals(Captures.text(item, Captures.STATUS))) {
            return;
        }
        CaptureService service = Framework.getService(CaptureService.class);
        Profile profile = service.profile(Captures.text(item, Captures.PROFILE));
        Blob file = item.getPropertyValue(Captures.FILE) instanceof Blob blob ? blob : null;
        if (file != null && file.getDigest() != null) {
            item.setPropertyValue(Captures.DIGEST, file.getDigest());
        }
        if (profile == null || file == null) {
            queue(system, item, Captures.NOT_FILED, null);
            return;
        }
        String providerId = service.activeProviderId();
        CaptureProvider provider = providerId == null ? null : service.provider(providerId);
        if (provider == null) {
            queue(system, item, Captures.NO_PROVIDER, null);
            return;
        }
        item.setPropertyValue(Captures.PROVIDER, providerId);
        Submission submission = new Submission(system, item, file, profile);
        Classification classification;
        Extraction extraction = null;
        try {
            classification = provider.classify(submission);
            var captureClass = classification == null ? null
                    : profile.captureClass(classification.className()).orElse(null);
            if (captureClass != null) {
                extraction = provider.extract(submission, captureClass);
            }
        } catch (CaptureProviderException e) {
            log.warn("Capture: item {} was not classified, and waits for a person: {}", itemId, e.kind());
            queue(system, item, Captures.PROVIDER_FAILED, null);
            return;
        } catch (RuntimeException e) {
            log.warn("Capture: item {} was not classified, and waits for a person: the provider {} failed ({})",
                    itemId, providerId, e.getClass().getSimpleName());
            queue(system, item, Captures.PROVIDER_FAILED, null);
            return;
        }
        Verdict verdict = ConfidenceRule.judge(profile, classification, extraction);
        item.setPropertyValue(Captures.CLASSIFIED_AT, Filing.now());
        propose(item, verdict);
        List<String> matches = verdict.keys().isEmpty() ? List.of()
                : Matcher.match(system, profile, verdict.captureClass(), verdict.keys());
        if (matches.size() == 1) {
            item.setPropertyValue(Captures.PROPOSED_RECORD, matches.get(0));
            item.setPropertyValue(Captures.RECORD, matches.get(0));
        }
        String reason = verdict.reason();
        if (reason == null) {
            reason = matches.isEmpty() ? Captures.UNMATCHED : matches.size() > 1 ? Captures.AMBIGUOUS : null;
        }
        if (reason != null) {
            queue(system, item, reason, verdict);
            return;
        }
        DocumentModel record = system.getDocument(new IdRef(matches.get(0)));
        if (!Matcher.inScope(profile, record) || !record.hasSchema(Captures.ATTACHMENTS_SCHEMA)) {
            queue(system, item, Captures.NOT_FILED, verdict);
            return;
        }
        if (!Filing.claim(item)) {
            // Another filing of this item holds it: it is that one's to finish.
            return;
        }
        String attachment = Filing.attach(system, item, record);
        Filing.markFiled(item, record, attachment, Captures.AUTOMATIC, Captures.SYSTEM);
        ServerWrite.ITEM.mark(item);
        DocumentModel saved = system.saveDocument(item);
        Filing.audit(system, null, saved, record, attachment, Captures.AUTOMATIC, Captures.SYSTEM);
    }

    /** The provider's answer, kept as its proposal, and the person's fields set from it. */
    private static void propose(DocumentModel item, Verdict verdict) {
        String className = verdict.captureClass() == null ? null : verdict.captureClass().name();
        item.setPropertyValue(Captures.PROPOSED_CLASS, className);
        item.setPropertyValue(Captures.CLASS_CONFIDENCE, verdict.classConfidence());
        item.setPropertyValue(Captures.CONFIDENCE, verdict.confidence());
        List<Map<String, Serializable>> extracted = new ArrayList<>();
        List<Map<String, Serializable>> fields = new ArrayList<>();
        for (ExtractedField field : verdict.fields()) {
            Map<String, Serializable> entry = new HashMap<>();
            entry.put("name", field.name());
            entry.put("value", field.value());
            entry.put("confidence", field.confidence());
            extracted.add(entry);
            Map<String, Serializable> person = new HashMap<>();
            person.put("name", field.name());
            person.put("value", field.value());
            fields.add(person);
        }
        item.setPropertyValue(Captures.EXTRACTED, (Serializable) extracted);
        item.setPropertyValue(Captures.CLASS, className);
        item.setPropertyValue(Captures.FIELDS, (Serializable) fields);
    }

    /** The item waits for a person, with its reason: saved, and audited. */
    static void queue(CoreSession system, DocumentModel item, String reason, Verdict verdict) {
        item.setPropertyValue(Captures.STATUS, Captures.REVIEW);
        item.setPropertyValue(Captures.REASON, reason);
        ServerWrite.ITEM.mark(item);
        DocumentModel saved = system.saveDocument(item);
        log.info("Capture: item {} waits for a person: {}", saved.getId(), reason);
        CaptureAudit.queued(system, saved, reason,
                verdict == null || verdict.captureClass() == null ? null : verdict.captureClass().name(),
                verdict == null ? 0 : verdict.confidence());
    }
}
